import { app } from 'electron'
import path    from 'path'
import fs      from 'fs'
import { store } from './store'
import type { Account } from './store'

// Patch global.fetch pour mc-java-core :
//  1. Force HTTPS (le JSON contient des URLs http://)
//  2. Intercepte la liste de fichiers pour gérer les mods optionnels :
//     - actifs  → path modoptionnel/X  devient  mods/X  (MC les charge)
//     - inactifs→ supprimés de la liste (mc-java-core ne les télécharge pas,
//                 checkFiles les supprime s'ils existaient)
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
    return _nativeFetch(input, init).then(async res => {
      const json = await res.json() as Array<{ url: string; size: number; hash: string; path: string }>
      const enabled = (store.get('enabledOptionalMods') as string[]) ?? []
      const transformed = json
        .map(entry => {
          if (!entry.path?.startsWith('modoptionnel/')) return entry
          if (enabled.includes(entry.path)) {
            // Actif → placer dans mods/ pour que Forge le charge
            return { ...entry, path: entry.path.replace('modoptionnel/', 'mods/') }
          }
          return null  // Inactif → retiré de la liste
        })
        .filter(Boolean)
      return new Response(JSON.stringify(transformed), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
  }

  return _nativeFetch(input, init)
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

let currentLaunch: LaunchInstance | null = null

export function isRunning(): boolean {
  return currentLaunch !== null
}

export function stopLaunch(): void {
  currentLaunch?.kill?.()
  currentLaunch = null
}

// ─────────────────────────────────────────────────────────────────────────────

export function startLaunch(
  account:    Account,
  ram:        number,
  javaPath:   string | null,
  onProgress: (data: LaunchProgressEvent) => void,
  onLog:      (line: string) => void,
  onClose:    (code: number | null) => void,
  onError:    (err: string) => void
): { ok: boolean; error?: string } {

  if (isRunning()) return { ok: false, error: 'Minecraft est déjà en cours d\'exécution.' }

  const userData    = app.getPath('userData')
  const basePath    = path.join(userData, 'EarthKingdoms')        // racine mc-java-core
  const instanceDir = path.join(basePath, 'instances', 'EarthKingdoms') // dossier Minecraft

  const authenticator = {
    name:          account.username,
    uuid:          account.uuid,
    access_token:  account.token,
    token_expires: account.tokenExpires,
    meta: {
      type:     'EarthKingdoms',
      online:   false,
      username: account.username,
      is_admin: account.isAdmin,
    },
  }

  const maxRamMB = Math.round(ram * 1024)
  const minRamMB = Math.max(512, Math.round((ram - 0.5) * 1024))

  // JVM args : G1GC + Java 17 add-opens (obligatoire Forge 1.20.1)
  const jvmArgs = [
    // Token EarthKingdoms (auth serveur)
    `-Dearthkingdoms.token=${account.token}`,
    '-Dearthkingdoms.api.url=https://earthkingdoms-mc.fr/api',

    // G1GC (Aikar's flags adaptés)
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200',
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC',
    '-XX:+AlwaysPreTouch',
    '-XX:G1NewSizePercent=30',
    '-XX:G1MaxNewSizePercent=40',
    '-XX:G1HeapRegionSize=8M',
    '-XX:G1ReservePercent=20',
    '-XX:G1HeapWastePercent=5',
    '-XX:G1MixedGCCountTarget=4',
    '-XX:InitiatingHeapOccupancyPercent=15',
    '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:G1RSetUpdatingPauseTimePercent=5',
    '-XX:SurvivorRatio=32',
    '-XX:+PerfDisableSharedMem',
    '-XX:MaxTenuringThreshold=1',

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

  const storedW   = store.get('resolutionWidth')  as number
  const storedH   = store.get('resolutionHeight') as number
  const resWidth  = (storedW  && storedW  !== 1920) ? storedW  : 854
  const resHeight = (storedH  && storedH  !== 1080) ? storedH  : 480

  const options = {
    url: 'https://earthkingdoms-mc.fr/launcher/files/?instance=EarthKingdomsV4-beta',
    authenticator,
    timeout:       300000,
    path:          basePath,         // dossier BASE — mc-java-core y crée /instances/, /versions/, /libraries/…
    instance:      'EarthKingdoms',
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
    verify:    true,
    ignored:   [
      // Forge génère ce fichier lui-même, le serveur renvoie une 404 HTML
      'config/fml.toml',
      // Fichiers/dossiers générés par le joueur — ne jamais supprimer
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

  try {
    const launch = new MCCore.Launch()
    currentLaunch = launch

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
      process.off('unhandledRejection', onUnhandledRejection)
      currentLaunch = null
      fn()
    }

    // mc-java-core appelle this.start() sans await → les rejections non catchées
    // n'atteignent pas notre .catch(). Ce handler les intercepte au niveau process.
    const onUnhandledRejection = (reason: unknown) => {
      if (currentLaunch !== launch) return
      finish(() => onError(formatError(reason)))
    }
    process.on('unhandledRejection', onUnhandledRejection)

    launch.on('close', (code: number | null) => {
      finish(() => onClose(code))
    })

    launch.on('error', (err: any) => {
      finish(() => onError(formatError(err)))
    })

    // Écrit le fichier .ek_auth aux deux emplacements attendus par le mod MC
    const ekAuth = JSON.stringify({ token: account.token, username: account.username, expires: account.tokenExpires })
    try { fs.writeFileSync(path.join(app.getPath('appData'), '.ek_auth'), ekAuth, 'utf8') } catch { /* ignore */ }
    try { fs.mkdirSync(instanceDir, { recursive: true }); fs.writeFileSync(path.join(instanceDir, '.ek_auth'), ekAuth, 'utf8') } catch { /* ignore */ }

    // Fire-and-forget — les events gèrent tout
    launch.Launch(options).catch((err: any) => {
      finish(() => onError(formatError(err)))
    })

    return { ok: true }

  } catch (err: any) {
    currentLaunch = null
    return { ok: false, error: typeof err === 'string' ? err : (err?.message ?? String(err)) }
  }
}
