import { screen } from 'electron'
import path    from 'path'
import fs      from 'fs'
import { store } from './store'
import type { Account, LaunchProfile } from './store'
import { gcArgs, applyGameOptions, needsInitialGameOptions } from './perfProfiles'
import { getLauncherUA } from './auth'
import { ensureDevServerEntry } from './devServer'
import { gameRoot, instanceDir as getInstanceDir, INSTANCE_NAME } from './paths'
import { createGameSession } from './gameSession'

/**
 * Identifiants du lancement en cours, figés au démarrage. Le patch de fetch
 * ci-dessous les utilise à la place du compte actif du launcher : changer de
 * compte ou se déconnecter pendant un téléchargement ne doit ni faire basculer
 * un lancement déjà commencé sur les droits d'un autre compte, ni lui retirer les siens.
 */
let launchAuth: { token: string; isAdmin: boolean } | null = null

/** Session de jeu unique - voir gameSession.ts pour le contrat de découplage. */
export const gameSession = createGameSession()

// Patch global.fetch pour mc-java-core :
//  1. Force HTTPS (le JSON contient des URLs http://)
//  2. Intercepte la liste de fichiers pour gérer les mods optionnels et admin :
//     - actifs  → path modoptionnel/X ou modadmin/X  devient  mods/X  (MC les charge)
//     - inactifs→ supprimés de la liste (mc-java-core ne les télécharge pas,
//                 checkFiles les supprime s'ils existaient)
//     - Le token Bearer est envoyé au serveur : c'est lui qui décide quels
//       fichiers modadmin/ retourner (validation côté serveur).
const instanceDir = () => getInstanceDir(INSTANCE_NAME)

/** Dossiers que le launcher a le droit de synchroniser et de nettoyer. */
const MANAGED_DIRS = ['mods', 'config']
const isManagedPath = (p: string | undefined) => MANAGED_DIRS.includes((p ?? '').split('/')[0])

/**
 * mc-java-core supprime de l'instance tout fichier absent du modpack et absent de
 * `ignored`. On protège donc tout ce qui existe déjà à la racine de l'instance
 * (options, sauvegardes, serveurs, caches de mods…) sauf mods/ et config/, seuls
 * dossiers dont le launcher garde la maîtrise.
 */
function protectedEntries(): string[] {
  try {
    return fs.readdirSync(instanceDir()).filter(name => !MANAGED_DIRS.includes(name))
  } catch {
    return []  // première installation : rien à protéger
  }
}

const _nativeFetch = global.fetch
;(global as any).fetch = function(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof input === 'string' && input.startsWith('http://earthkingdoms-mc.fr')) {
    input = 'https://' + input.slice(7)
  }

  if (
    typeof input === 'string' &&
    input.includes('earthkingdoms-mc.fr/launcher/files/') &&
    input.includes('instance=')
  ) {
    const isAdmin = launchAuth?.isAdmin === true

    // Ajoute l'User-Agent launcher sur toutes les requêtes vers earthkingdoms-mc.fr
    // pour le bypass Cloudflare bot protection
    const ua = getLauncherUA()
    const patchedHeaders = new Headers((init as RequestInit | undefined)?.headers)
    patchedHeaders.set('User-Agent', ua)
    if (launchAuth?.token) patchedHeaders.set('Authorization', `Bearer ${launchAuth.token}`)
    const patchedInit = { ...(init as RequestInit | undefined), headers: patchedHeaders }

    return _nativeFetch(input, patchedInit as RequestInit).then(async res => {
      const raw = await res.json()
      if (!Array.isArray(raw)) {
        const message = (raw as { error?: string })?.error ?? 'Réponse invalide du serveur de fichiers.'
        throw new Error(`Instance introuvable ou inaccessible (${message})`)
      }
      const json = raw as Array<{ url: string; size: number; hash: string; path: string }>
      const enabled = (store.get('enabledOptionalMods') as string[]) ?? []

      const transformed = json
        .map(entry => {
          if (entry.path?.startsWith('modoptionnel/')) {
            if (enabled.includes(entry.path)) {
              return { ...entry, path: entry.path.replace('modoptionnel/', 'mods/') }
            }
            return null  // Inactif → retiré de la liste
          }
          if (entry.path?.startsWith('modadmin/')) {
            // Double vérification client : isAdmin doit être true (défense en profondeur).
            // TODO: une fois le serveur mis à jour, il n'enverra ces fichiers
            // qu'aux tokens admin - la sécurité principale sera côté serveur.
            if (isAdmin && enabled.includes(entry.path)) {
              return { ...entry, path: entry.path.replace('modadmin/', 'mods/') }
            }
            return null  // Non admin ou inactif → retiré de la liste
          }
          return entry
        })
        .filter(Boolean)
        // Seuls mods/ et config/ sont gérés par le launcher : tout autre fichier du
        // modpack n'est téléchargé que s'il est absent, jamais réécrit par-dessus
        // la version du joueur (options.txt, servers.dat, journeymap/…).
        .filter(entry => isManagedPath(entry!.path) || !fs.existsSync(path.join(instanceDir(), entry!.path)))
      return new Response(JSON.stringify(transformed), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
  }

  return _nativeFetch(input, init)
}

/**
 * Un JAR est une archive zip : il se termine par un enregistrement « End of Central
 * Directory » (signature PK\x05\x06), placé au plus à 64 Ko + 22 octets de la fin.
 * Un téléchargement interrompu (coupure réseau, antivirus, fermeture du launcher)
 * laisse un fichier tronqué sans cet enregistrement.
 */
function isTruncatedJar(file: string): boolean {
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    if (size < 22) return true
    const tailLen = Math.min(size, 0xFFFF + 22)
    const tail = Buffer.alloc(tailLen)
    fs.readSync(fd, tail, 0, tailLen, size - tailLen)
    return tail.lastIndexOf(Buffer.from([0x50, 0x4B, 0x05, 0x06])) === -1
  } catch {
    return false  // illisible (verrouillé…) : on laisse mc-java-core décider
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}

/**
 * mc-java-core ne retélécharge une bibliothèque Forge que si elle est ABSENTE
 * (aucune vérification de taille ni de hash). Un JAR tronqué reste donc en place
 * indéfiniment et fait échouer le patcher Forge à chaque lancement
 * (« Impossible de déterminer la classe principale dans le JAR »). On supprime
 * ces fichiers avant le lancement pour qu'ils soient retéléchargés.
 */
function purgeTruncatedForgeLibraries(onLog: (line: string) => void): void {
  const root = path.join(gameRoot(), 'loader', 'forge', 'libraries')
  let files: string[]
  try {
    files = fs.readdirSync(root, { recursive: true }) as string[]
  } catch {
    return  // première installation : rien à vérifier
  }
  for (const rel of files) {
    if (!rel.endsWith('.jar')) continue
    const file = path.join(root, rel)
    if (!isTruncatedJar(file)) continue
    try {
      fs.rmSync(file, { force: true })
      onLog(`Bibliothèque Forge corrompue supprimée (sera retéléchargée) : ${rel}`)
    } catch { /* ignore */ }
  }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const MCCore = require('minecraft-java-core') as { Launch: new () => LaunchInstance }

interface LaunchInstance {
  on(event: string, cb: (...args: any[]) => void): void
  Launch(options: object): Promise<void>
  kill?(): void
}

export interface LaunchProgressEvent {
  event:  'progress' | 'check' | 'extract' | 'patch' | 'speed'
  type?:  string    // asset type (mods, minecraft, java, libraries…)
  task?:  number
  total?: number
  speed?: number    // bytes/s (only for event: 'speed')
}

// ─────────────────────────────────────────────────────────────────────────────

/** true dès qu'un lancement a démarré (téléchargements puis jeu). */
export function isRunning(): boolean {
  return gameSession.isRunning()
}

/** Arrêt explicite demandé par l'utilisateur ou le launcher - jamais par l'authentification. */
export function stopLaunch(): void {
  gameSession.stop()
}

// ─────────────────────────────────────────────────────────────────────────────

export function startLaunch(
  account:       Account,
  profile:       LaunchProfile,
  onProgress:    (data: LaunchProgressEvent) => void,
  onLog:         (line: string) => void,
  onClose:       (code: number | null) => void,
  onError:       (err: string) => void,
  dev = false,
  // Jeton à usage unique (12 h côté Web, voir game-token/route.ts) obtenu du Web juste avant l'appel à startLaunch,
  // distinct du LauncherToken de session (account.token). Vérifié localement
  // par Core sans rappel au Web. C'est le SEUL credential transmis au jeu : le
  // token de session du launcher ne lui est ni transmis ni écrit sur disque.
  gameAuthToken?: string
): { ok: boolean; error?: string } {

  if (gameSession.isRunning()) return { ok: false, error: 'Minecraft est déjà en cours d\'exécution.' }

  const { ram, javaPath, perfLevel } = profile

  const basePath     = gameRoot()                                   // racine mc-java-core
  // Une seule instance pour prod et dev (voir paths.ts) : le mode dev change le modpack
  // téléchargé et le serveur rejoint, pas le dossier du joueur.
  const instanceName = INSTANCE_NAME
  const instanceDir  = getInstanceDir(instanceName) // dossier Minecraft

  if (dev) ensureDevServerEntry(instanceDir)

  // Le jeu ne reçoit PAS le token de session du launcher. Core ne l'utilise nulle
  // part (voir docs/architecture.md) et le placer sur la ligne de commande de la
  // JVM l'exposerait à la liste des processus, aux rapports de crash (hs_err) et
  // aux logs partagés. Seul le jeton de lancement à usage unique (gameAuthToken)
  // lui est transmis. Valeur fixe non secrète : mc-java-core exige un
  // access_token, et Minecraft ne s'en sert pas hors serveur « online ».
  const authenticator = {
    name:          account.username,
    uuid:          account.uuid,
    access_token:  'ek-launcher-no-session',
    token_expires: 0,
    meta: {
      type:     'EarthKingdoms',
      online:   false,
      username: account.username,
      is_admin: account.isAdmin,
    },
  }

  const maxRamMB = Math.round(ram * 1024)
  const minRamMB = Math.max(512, Math.round((ram - 0.5) * 1024))

  // JVM args : GC réglé par le palier de performance (voir perfProfiles.gcArgs)
  // + Java 17 add-opens (obligatoire Forge 1.20.1)
  const jvmArgs = [
    `-Dek.launcher.username=${account.username}`,
    '-Dearthkingdoms.api.url=https://earthkingdoms-mc.fr/api',
    // GameAuthToken (12 h, usage unique) : preuve que le Web a autorisé CE lancement,
    // distincte du token de session du launcher. Absente si l'appel a échoué -
    // dans ce cas startLaunch n'est de toute façon pas appelé (voir index.ts).
    ...(gameAuthToken ? [`-Dek.launcher.gameAuthToken=${gameAuthToken}`] : []),

    // G1GC (flags d'Aikar, ajustés selon le palier et la taille du tas)
    ...gcArgs(perfLevel, maxRamMB),

    // Crash dumps
    '-XX:+HeapDumpOnOutOfMemoryError',
    `-XX:HeapDumpPath=${instanceDir}/heap_dump.hprof`,
    '-XX:+ShowCodeDetailsInExceptionMessages',

    // Java 17 + Forge 1.20.1 (modules requis)
    '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
    '--add-opens', 'java.base/java.lang.reflect=ALL-UNNAMED',
    '--add-opens', 'java.base/java.util=ALL-UNNAMED',
    '--add-opens', 'java.base/java.util.concurrent=ALL-UNNAMED',
    '--add-opens', 'java.base/java.io=ALL-UNNAMED',
    '--add-opens', 'java.base/java.nio=ALL-UNNAMED',
    '--add-opens', 'java.base/sun.nio.ch=ALL-UNNAMED',
    '--add-opens', 'java.base/java.net=ALL-UNNAMED',
    '--add-opens', 'java.base/java.text=ALL-UNNAMED',
    '--add-opens', 'java.desktop/java.awt.font=ALL-UNNAMED',
  ]

  // Résolution de la fenêtre de jeu, issue du profil actif. Bornée à l'écran :
  // demander plus grand que le bureau ouvrirait une fenêtre partiellement hors
  // champ, sans aucun gain visuel.
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
  const resWidth  = Math.min(profile.resW || 854, screenW)
  const resHeight = Math.min(profile.resH || 480, screenH)

  // Instance de fichiers côté serveur - le modpack dev diffère substantiellement
  // de la prod (ekcore fusionné, outils de worldgen/debug en plus), d'où une
  // instance distincte plutôt qu'un simple flag sur la même instance.
  const filesInstance = dev ? 'EarthKingdomsV4-beta-dev' : 'EarthKingdomsV4-beta'

  const options = {
    url: `https://earthkingdoms-mc.fr/launcher/files/?instance=${filesInstance}`,
    authenticator,
    timeout:       300000,
    path:          basePath,         // dossier BASE - mc-java-core y crée /instances/, /versions/, /libraries/…
    instance:      instanceName,
    version:       '1.20.1',
    detached:      true,
    loader: {
      type:   'forge',
      build:  '1.20.1-47.4.10',
      enable: true,
    },
    java: {
      path:         javaPath || null,
      autoDownload: true,
    },
    JVM_ARGS:  jvmArgs,
    GAME_ARGS: [],
    // mc-java-core passe sinon -Dlog4j.configurationFile=C:/…/client-1.12.xml : log4j
    // prend « C: » pour un schéma d'URL, rejette la config (« Invalid URL ») et retombe
    // sur sa config par défaut, console seule - aucun logs/latest.log n'est écrit sous
    // Windows. La version Forge déclare d'ailleurs "logging": {} pour utiliser son
    // propre log4j2.xml (logs/latest.log + logs/debug.log).
    ignore_log4j: true,
    verify:    true,
    ignored:   [
      ...protectedEntries(),
      // config/ reste synchronisée avec le modpack (les fichiers listés sont mis à
      // jour), mais n'est jamais vidée : l'instance beta ne liste aucun fichier de
      // config, et sans ça chaque lancement beta supprimerait toute la config.
      'config',
      // Forge génère ce fichier lui-même, le serveur renvoie une 404 HTML
      'config/fml.toml',
      // Caches écrits par des mods dans mods/ (dossier géré, donc nettoyé) : sans ça
      // ils sont supprimés à chaque lancement et entièrement régénérés au démarrage.
      'mods/mcef-libraries',   // binaires Chromium de MCEF (~280 Mo)
      'mods/mcef-cache',       // cache navigateur de MCEF
      'mods/.connector',       // jars remappés par Sinytra Connector
      // Fichiers/dossiers générés par le joueur - ne jamais supprimer
      'options.txt',
      'optionsof.txt',
      'saves',
      'screenshots',
      'logs',
      'crash-reports',
      'resourcepacks',
      'shaderpacks',
      'local',
      'backups',
      'global_packs',
    ],
    memory: {
      min: `${minRamMB}M`,
      max: `${maxRamMB}M`,
    },
    screen: { width: resWidth, height: resHeight },
  }

  // Première installation : aucun options.txt n'existe encore, on y écrit les
  // réglages graphiques du palier. Sur une instance déjà jouée on n'y touche
  // pas ici - c'est un geste explicite depuis les paramètres (perf:applyGameOptions).
  if (needsInitialGameOptions(instanceDir)) applyGameOptions(instanceDir, perfLevel, profile.gameOptions)

  purgeTruncatedForgeLibraries(onLog)

  launchAuth = { token: account.token, isAdmin: account.isAdmin }

  try {
    const launch = new MCCore.Launch()
    gameSession.attach(launch)

    // mc-java-core émet (task, total, element) comme args séparés.
    // On n'envoie PAS element via IPC (objet potentiellement non-sérialisable).
    launch.on('extract',  () => onProgress({ event: 'extract' }))
    launch.on('progress', (task: number, total: number) =>
      onProgress({ event: 'progress', task, total }))
    launch.on('check',    (task: number, total: number) =>
      onProgress({ event: 'check',    task, total }))
    launch.on('patch',    ()       => onProgress({ event: 'patch' }))
    launch.on('speed',    (speed: number) => onProgress({ event: 'speed', speed }))

    launch.on('data', (eOrData: any, dataOrUndef?: any) => {
      const raw = dataOrUndef !== undefined
        ? (typeof dataOrUndef === 'string' ? dataOrUndef : String(dataOrUndef))
        : (typeof eOrData    === 'string' ? eOrData    : String(eOrData))
      const line = raw.replace(/\x1B\[[0-9;]*[mGKHF]/g, '') // strip ANSI
      if (line.trim()) onLog(line.trim())
    })

    // mc-java-core peut émettre plusieurs events 'error' pour un seul problème
    // (DownloadGame émet error puis retourne undefined → start() émet error(undefined))
    // → handled flag pour n'en traiter qu'un seul.
    let handled = false

    const formatError = (err: unknown): string => {
      if (typeof err === 'string')      return err
      if (err == null)                  return 'Erreur inconnue lors du lancement.'
      const e = err as Record<string, unknown>
      if (typeof e.error   === 'string') return e.error
      if (typeof e.message === 'string') return e.message
      return JSON.stringify(err)
    }

    const finish = (fn: () => void) => {
      if (handled) return
      handled = true
      // @types/node ne déclare pas de surcharge « unhandledRejection » pour
      // off(), alors qu'Electron en ajoute une pour son seul évènement 'loaded'
      // sur NodeJS.Process - celle-ci masque la signature générique héritée
      // d'EventEmitter. On passe donc explicitement par EventEmitter, qui est
      // la même méthode à l'exécution.
      ;(process as NodeJS.EventEmitter).off('unhandledRejection', onUnhandledRejection)
      launchAuth = null
      gameSession.release()
      fn()
    }

    // mc-java-core appelle this.start() sans await → les rejections non catchées
    // n'atteignent pas notre .catch(). Ce handler les intercepte au niveau process.
    const onUnhandledRejection = (reason: unknown) => {
      if (handled) return
      finish(() => onError(formatError(reason)))
    }
    process.on('unhandledRejection', onUnhandledRejection)

    launch.on('close', (code: number | null) => {
      finish(() => onClose(code))
    })

    launch.on('error', (err: any) => {
      finish(() => onError(formatError(err)))
    })

    // Fire-and-forget - les events gèrent tout
    launch.Launch(options).catch((err: any) => {
      finish(() => onError(formatError(err)))
    })

    return { ok: true }

  } catch (err: any) {
    launchAuth = null
    gameSession.release()
    return { ok: false, error: typeof err === 'string' ? err : (err?.message ?? String(err)) }
  }
}
