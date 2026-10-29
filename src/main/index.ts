import { app, BrowserWindow, dialog, ipcMain, net, shell } from 'electron'
import { join, basename } from 'path'
import { gameRoot, instanceDir, migrateLegacyGameRoot, INSTANCE_NAME } from './paths'

// Permet l'autoplay audio sans geste utilisateur → préchauffage pipeline au démarrage
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync, rmSync, existsSync } from 'fs'
import { totalmem } from 'os'
import { randomUUID, createHash } from 'crypto'
import {
  store, migrateProfiles, getActiveProfile, BUILTIN_PROFILE_IDS,
  setBetaChannel, isBetaChannel, builtinIdFor, getActiveProfileId, setActiveProfileId,
  fallbackProfileId, profilesOfChannel,
} from './store'
import {
  modsForLevel, modTier, applyGameOptions, gameOptionsFor, EDITABLE_GAME_KEYS,
  LEVEL_LABELS, LEVEL_DESCS, PERF_LEVELS, isPerfLevel, recommendedRam,
} from './perfProfiles'
import { detectHardware } from './hardware'
import {
  login, logout, getAccount, getActiveAccount, getAccountByUuid, getAccounts, switchAccount, removeAccount,
  getLauncherUA, getGameAuthToken, resetActiveToken, authedRequest, toPublic, setAuthLogger, purgeLegacyAuthFiles,
} from './auth'
import { createSkinService, createSerialQueue, resolveSkinUrl, SKIN_MAX_BYTES } from './skins'

/** net.fetch avec User-Agent launcher - permet le bypass Cloudflare bot protection */
function ekFetch(url: string, init?: Parameters<typeof net.fetch>[1]): ReturnType<typeof net.fetch> {
  const headers = new Headers(init?.headers)
  headers.set('User-Agent', getLauncherUA())
  return net.fetch(url, { ...init, headers })
}
import { startLaunch, stopLaunch, isRunning, gameSession } from './launcherCore'
import type { LaunchProgressEvent } from './launcherCore'
import { autoUpdater } from 'electron-updater'
import type { Account, LaunchProfile } from './store'

let mainWindow: BrowserWindow | null = null
let launchStartTime = 0
// Phase du lancement en cours, relue par l'accueil quand il est remonté (changement
// d'onglet pendant un téléchargement) : sans elle, il ne saurait pas distinguer un
// téléchargement d'un jeu déjà démarré.
let launchPhase: { dev: boolean; gameStarted: boolean; hadDownload: boolean; lastProgress: LaunchProgressEvent | null } =
  { dev: false, gameStarted: false, hadDownload: false, lastProgress: null }

const LIVEMAP_ORIGIN = 'https://earthkingdoms-mc.fr'

/** Les liens ouverts dans le navigateur système sont limités à http(s). */
function isSafeExternalUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 2048) return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

// ── Garde-fou « modifications non sauvegardées » ─────────────────────────────
//
// Le renderer lève ce drapeau quand un écran a des réglages en cours de
// modification. Tant qu'il est baissé - le cas normal - la fermeture n'est pas
// interceptée du tout : aucun risque d'empêcher la fenêtre de se fermer.
let unsavedGuard   = false
let allowWindowClose = false
let closeTimer: ReturnType<typeof setTimeout> | null = null

/** Autorise la prochaine fermeture sans poser de question (quit, mise à jour). */
function allowClose(): void {
  allowWindowClose = true
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
}

// ── Logs launcher persistants ─────────────────────────────────────────────────
let launcherLogFile: string | null = null

function initLauncherLog(): void {
  const dir = join(gameRoot(), 'logs')
  mkdirSync(dir, { recursive: true })

  // Rotation : supprime les fichiers launcher-*.log de plus de 7 jours
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  try {
    for (const f of readdirSync(dir)) {
      if (!f.startsWith('launcher-') || !f.endsWith('.log')) continue
      const full = join(dir, f)
      if (statSync(full).mtimeMs < cutoff) unlinkSync(full)
    }
  } catch { /* silencieux */ }

  const date = new Date().toISOString().slice(0, 10)
  launcherLogFile = join(dir, `launcher-${date}.log`)
}

function wlog(msg: string): void {
  if (!launcherLogFile) return
  const ts = new Date().toISOString()
  try { appendFileSync(launcherLogFile, `[${ts}] ${msg}\n`, 'utf-8') } catch { /* silencieux */ }
}

// Buffer des logs MC - conservés entre navigations, effacés à chaque nouveau lancement
const logBuffer: string[] = []
const LOG_BUFFER_MAX = 2000

function createWindow(): void {
  // Icône de fenêtre : build/icon.png (source unique des icônes, voir electron-builder.yml).
  // Windows et macOS prennent celle de l'exécutable / du bundle une fois empaqueté ;
  // elle sert en développement et sous Linux.
  const windowIcon = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'build', 'icon.png')
  if (process.platform === 'darwin' && !app.isPackaged) {
    try { app.dock?.setIcon(windowIcon) } catch { /* cosmétique */ }
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1024,
    minHeight: 640,
    frame: false,
    icon: windowIcon,
    backgroundColor: '#0E0A2A',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Le preload n'utilise que contextBridge/ipcRenderer (aucun require() de
      // module Node arbitraire) - entièrement compatible avec le mode sandbox.
      sandbox: true,
      webviewTag: true,
    }
  })

  const win = mainWindow
  allowWindowClose = false

  // Sous macOS l'application survit à la fermeture de sa fenêtre (le jeu aussi) :
  // sans cette remise à zéro, mainWindow pointerait sur une fenêtre détruite et le
  // premier `mainWindow?.webContents.send(...)` d'un évènement du jeu lèverait
  // « Object has been destroyed » dans le process main.
  win.on('closed', () => { if (mainWindow === win) mainWindow = null })

  // Le renderer ne doit jamais ouvrir de fenêtre ni naviguer hors de l'application :
  // tout lien externe passe par open:external (http/https uniquement).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const dev = process.env['ELECTRON_RENDERER_URL']
    const internal = dev ? url.startsWith(dev) : url.startsWith('file://')
    if (!internal) {
      e.preventDefault()
      if (isSafeExternalUrl(url)) void shell.openExternal(url)
    }
  })
  // Seule la Livemap du site peut être embarquée, sans aucun accès Node ni preload.
  win.webContents.on('will-attach-webview', (e, webPreferences, params) => {
    delete (webPreferences as { preload?: string }).preload
    webPreferences.nodeIntegration  = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox          = true
    if (!params.src.startsWith(LIVEMAP_ORIGIN + '/')) e.preventDefault()
  })

  win.on('close', (e) => {
    if (allowWindowClose || !unsavedGuard) return
    e.preventDefault()
    win.webContents.send('app:before-close')

    // Filet de sécurité : si le renderer ne répond jamais (page plantée, écran
    // d'erreur), la fenêtre se ferme quand même au lieu de rester bloquée.
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = setTimeout(() => {
      closeTimer = null
      allowWindowClose = true
      win.close()
    }, 8000)
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.on('app:unsaved-guard', (_e, on: boolean) => { unsavedGuard = on === true })

ipcMain.on('app:close-response', (_e, doClose: boolean) => {
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
  if (doClose) {
    allowWindowClose = true
    mainWindow?.close()
  }
})

app.whenReady().then(() => {
  migrateLegacyGameRoot()
  initLauncherLog()
  setAuthLogger(wlog)
  wlog(`Launcher démarré - v${app.getVersion()}`)
  // Les versions précédentes écrivaient le token de session en clair dans ces
  // fichiers, que le jeu n'a jamais lus : on les supprime.
  purgeLegacyAuthFiles(legacyAuthFiles())

  // Complète les profils enregistrés avant l'arrivée des paliers de performance
  // et garantit la présence des trois profils intégrés, puis répercute le profil
  // actif sur les clés globales lues ailleurs (RAM, résolution, mods actifs).
  migrateProfiles(Math.floor(totalmem() / 1024 / 1024 / 1024))
  applyActiveProfile()

  // Rafraîchit le catalogue en tâche de fond, puis réapplique le profil : un
  // mod optionnel ajouté côté serveur entre dans le bon palier sans que le
  // joueur ait à ouvrir l'onglet Mods.
  fetchModCatalogue().then(list => { if (list.length > 0) applyActiveProfile() })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // Quand téléchargé → redémarre l'app pour appliquer (Windows + Linux uniquement)
  if (app.isPackaged && process.platform !== 'darwin') {
    autoUpdater.on('update-available',   (info) => wlog(`Mise à jour disponible : ${(info as any)?.version ?? '?'}`))
    autoUpdater.on('download-progress',  (p: { percent: number }) => {
      mainWindow?.webContents.send('update:progress', Math.round(p.percent))
    })
    autoUpdater.on('update-downloaded',  (info) => {
      wlog(`Mise à jour téléchargée : ${(info as any)?.version ?? '?'} - redémarrage...`)
      stopLaunch()
      allowClose()
      setTimeout(() => autoUpdater.quitAndInstall(true, true), 500)
    })
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── Contrôles fenêtre ────────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())

// ── Lien externe ─────────────────────────────────────────────────────────────
ipcMain.on('open:external', (_e, url: unknown) => {
  if (isSafeExternalUrl(url)) void shell.openExternal(url)
  else wlog('open:external refusé (protocole non autorisé)')
})

/** Anciens emplacements du fichier .ek_auth (token en clair, plus écrit par ce launcher). */
function legacyAuthFiles(): string[] {
  return [join(app.getPath('appData'), '.ek_auth'), join(instanceDir(), '.ek_auth')]
}

// ── Persistance (electron-store) ─────────────────────────────────────────────
// Le renderer n'a accès qu'à des préférences : jamais aux comptes, tokens,
// profils ou catalogues, qui passent par des canaux dédiés côté main.
const num = (min: number, max: number) => (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const STORE_KEYS: Record<string, (v: unknown) => boolean> = {
  ram:               num(1, 128),
  resolutionWidth:   num(320, 7680),
  resolutionHeight:  num(240, 4320),
  javaPath:          (v) => v === null || isValidJavaPath(v),
  soundEnabled:      (v) => typeof v === 'boolean',
  closeOnLaunch:     (v) => typeof v === 'boolean',
  lastSeenNewsCount: num(0, 1_000_000),
}

/** Exécutable Java existant (java / javaw) : ce chemin est lancé tel quel. */
function isValidJavaPath(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 1024) return false
  if (!/^javaw?(\.exe)?$/i.test(basename(v))) return false
  try { return statSync(v).isFile() } catch { return false }
}

ipcMain.handle('store:get', (_e, key: string) => {
  if (!Object.prototype.hasOwnProperty.call(STORE_KEYS, key)) return undefined
  return store.get(key as keyof typeof store.store)
})
ipcMain.handle('store:set', (_e, key: string, value: unknown) => {
  if (!Object.prototype.hasOwnProperty.call(STORE_KEYS, key) || !STORE_KEYS[key](value)) {
    wlog(`store:set refusé (clé ou valeur invalide) : ${String(key).slice(0, 40)}`)
    return
  }
  store.set(key as keyof typeof store.store, value as never)
})


// ── Authentification EarthKingdoms ───────────────────────────────────────────
// Le renderer ne reçoit jamais de token : uniquement une vue publique du compte
// (voir PublicAccount). Se déconnecter, changer de compte ou perdre sa session ne
// touche en aucun cas au jeu déjà lancé (voir gameSession.ts).
ipcMain.handle('auth:login', async (_e, username: unknown, password: unknown) => {
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > 256) {
    return { ok: false, code: 0, message: 'Identifiants invalides.' }
  }
  const result = await login(username, password)
  if (result.ok) {
    wlog(`Auth: connexion réussie - ${result.account.username}`)
    return { ok: true, account: toPublic(result.account) }
  }
  wlog(`Auth: échec connexion - code ${result.code}`)
  return result
})

ipcMain.handle('auth:getAccount', async () => toPublic(await getAccount()))

ipcMain.handle('auth:logout', () => {
  const active = getActiveAccount()
  logout()
  // Aucun arrêt ni invalidation du jeu : il vit de son propre jeton de lancement.
  if (active) wlog(`Auth: déconnexion - ${active.username}${gameSession.isBusy() ? ' (jeu en cours, non affecté)' : ''}`)
  return toPublic(getActiveAccount())
})

// Debug : réinitialise le token (refresh forcé ; seule une réponse définitive du
// serveur déconnecte - une panne réseau laisse la session intacte).
ipcMain.handle('auth:resetToken', async () => {
  const result = await resetActiveToken(legacyAuthFiles())
  wlog(`Debug: reset token - ${result.status ?? 'erreur'}`)
  return result
})

// ── Statut serveur Minecraft ─────────────────────────────────────────────────
ipcMain.handle('server:status', async () => {
  try {
    const start = Date.now()
    const res   = await net.fetch('https://api.mcsrvstat.us/3/mc.earthkingdoms-mc.fr')
    const ping  = Date.now() - start
    if (!res.ok) return { online: false }
    const data = await res.json() as {
      online:  boolean
      players?: { online: number; max: number }
      version?: string
    }
    return {
      online:     data.online,
      players:    data.players?.online ?? 0,
      maxPlayers: data.players?.max    ?? 200,
      ping:       Math.round(ping / 2),
      version:    data.version ?? '1.20.1',
    }
  } catch {
    return { online: false }
  }
})

// ── Statut joueur (nation, solde, stats…) ────────────────────────────────────
ipcMain.handle('status:player', async () => {
  const account = getActiveAccount()
  if (!account) return { ok: false, error: 'Non connecté.' }
  const r = await authedRequest('/launcher/player', {}, account.uuid)
  if (r.kind === 'no-session' || r.kind === 'session-expired') return { ok: false, error: 'Session expirée. Reconnecte-toi.' }
  if (r.kind === 'unavailable') return { ok: false, error: 'Erreur réseau.' }
  if (r.res.status < 200 || r.res.status >= 300) return { ok: false, error: `Erreur serveur (${r.res.status})` }
  try {
    const data = await r.res.json() as Record<string, unknown> | null

    // Le serveur de jeu peut être injoignable (data = null) sans que ce soit une
    // erreur - dans ce cas on affiche quand même l'écran avec des "N/A" plutôt
    // que de bloquer sur un message d'erreur (même logique que /compte sur le site).
    if (data) return { ok: true, dataAvailable: true, player: data }

    return {
      ok: true,
      dataAvailable: false,
      player: {
        uuid: '', name: account.username, online: null, balance: null,
        nation: null, nationName: null, nationRank: null, jobs: null,
        kills: null, deaths: null, kda: null, playtime: null,
      },
    }
  } catch {
    return { ok: false, error: 'Réponse invalide du serveur.' }
  }
})

// ── News (JSON depuis l'API, contourne CSP) ───────────────────────────────────
ipcMain.handle('news:load', async () => {
  try {
    const res = await ekFetch('https://earthkingdoms-mc.fr/api/news?limit=8')
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
})

// ── Skins ─────────────────────────────────────────────────────────────────────
//
// Toute la logique (validation, doublons, restauration, vérification) vit dans
// skins.ts. Les opérations d'écriture sont sérialisées : un double clic ou une
// nouvelle tentative ne peut pas produire deux envois concurrents.
const skinHashCache = new Map<string, string>()
const runSkinWrite  = createSerialQueue()

async function fetchSkinBytes(url: string): Promise<{ status: number; bytes: Uint8Array } | null> {
  try {
    const res = await ekFetch(url, { cache: 'no-store' })
    return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) }
  } catch {
    return null
  }
}

function skinServiceFor(account: { uuid: string; username: string }) {
  return createSkinService({
    username:    account.username,
    authed:      (path, init) => authedRequest(path, init, account.uuid),
    fetchBytes:  fetchSkinBytes,
    sha256:      (bytes) => createHash('sha256').update(bytes).digest('hex'),
    newBoundary: () => `----EKBoundary${randomUUID()}`,
    log:         (m) => wlog(m),
  }, skinHashCache)
}

const toDataUrl = (bytes: Uint8Array) => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`
const bustCache = (url: string) => `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`

ipcMain.handle('skin:load', async (_e, username: unknown) => {
  // Source de vérité : l'URL du skin marqué is_current dans l'historique
  const account = getActiveAccount()
  if (account) {
    const listed = await skinServiceFor(account).listHistory()
    if (listed.ok) {
      const current = listed.history.find(h => h.is_current)
      const url = current ? resolveSkinUrl(current.skin_url) : null
      if (url) {
        const got = await fetchSkinBytes(bustCache(url))
        if (got?.status === 200) return toDataUrl(got.bytes)
        wlog(`Skin: échec téléchargement du skin actuel - HTTP ${got?.status ?? 'réseau'}`)
      } else {
        wlog('Skin: historique vide ou sans entrée is_current')
      }
    } else {
      wlog(`Skin: historique inaccessible - ${listed.error}`)
    }
  }
  // Repli : URL basée sur le pseudo (nom validé : jamais de chemin arbitraire).
  const valid = (n: unknown): n is string => typeof n === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(n)
  const name = valid(username) ? username : account?.username
  if (!valid(name)) return null
  const got = await fetchSkinBytes(bustCache(`https://earthkingdoms-mc.fr/skins/${name.toLowerCase()}.png`))
  if (!got || got.status !== 200) {
    wlog(`Skin: repli introuvable - HTTP ${got?.status ?? 'réseau'}`)
    return null
  }
  return toDataUrl(got.bytes)
})

ipcMain.handle('skin:loadUrl', async (_e, url: unknown) => {
  if (typeof url !== 'string') return null
  const full = resolveSkinUrl(url)      // uniquement l'hôte EarthKingdoms
  if (!full) return null
  const got = await fetchSkinBytes(bustCache(full))
  return got && got.status === 200 ? toDataUrl(got.bytes) : null
})

ipcMain.handle('skin:historyList', async () => {
  const account = getActiveAccount()
  if (!account) return { ok: false, error: 'Non connecté.' }
  return skinServiceFor(account).listHistory()
})

ipcMain.handle('skin:historyRestore', async (_e, historyId: unknown) => {
  const account = getActiveAccount()
  if (!account) return { ok: false, error: 'Non connecté ! Reconnecte-toi dans le launcher.' }
  const id = typeof historyId === 'number' ? String(historyId) : historyId
  if (typeof id !== 'string' || !/^\d{1,12}$/.test(id)) return { ok: false, error: 'Identifiant de skin invalide.' }

  const result = await runSkinWrite(() => skinServiceFor(account).restore(id))
  wlog(`Skin: restauration ${id} - ${result.ok ? result.outcome : result.error}`)
  return result
})

ipcMain.handle('skin:upload', async (_e, fileData: unknown) => {
  const account = getActiveAccount()
  if (!account) return { ok: false, error: 'Non connecté ! Reconnecte-toi dans le launcher.' }

  // Accepte un Uint8Array/ArrayBuffer (chemin normal) ou un tableau d'octets (ancien renderer).
  let bytes: Uint8Array
  if (fileData instanceof Uint8Array)       bytes = fileData
  else if (fileData instanceof ArrayBuffer) bytes = new Uint8Array(fileData)
  else if (Array.isArray(fileData) && fileData.length <= SKIN_MAX_BYTES) bytes = Uint8Array.from(fileData as number[])
  else return { ok: false, error: 'Fichier invalide.' }

  const result = await runSkinWrite(() => skinServiceFor(account).upload(bytes))
  wlog(`Skin: envoi - ${result.ok ? result.outcome : result.error}`)
  return result
})

// ── Paliers de performance ────────────────────────────────────────────────────
//
// Le profil actif est la source de vérité (palier, RAM, résolution, Java,
// sélection de mods). Les clés globales du store restent alimentées à partir de
// lui : plusieurs endroits du launcher les lisent encore directement (Footer,
// patch fetch de launcherCore, écran de paramètres).

interface CatalogueEntry { url: string; size: number; hash: string; path: string }

/**
 * Récupère la liste des mods optionnels et la mémorise.
 *
 * Le catalogue est indispensable aux paliers : sans lui, on ne sait pas quels
 * mods existent, donc pas lesquels activer. Il est donc rafraîchi au démarrage
 * et avant chaque lancement, pas seulement à l'ouverture de l'onglet Mods.
 */
async function fetchModCatalogue(dev = false): Promise<CatalogueEntry[]> {
  try {
    // La beta a son propre modpack côté serveur (voir launcherCore.filesInstance) :
    // son catalogue diffère de celui de la prod.
    const instance = dev ? 'EarthKingdomsV4-beta-dev' : 'EarthKingdomsV4-beta'
    const url      = `https://earthkingdoms-mc.fr/launcher/files/?instance=${instance}`

    // Avec un compte : requête authentifiée (le serveur décide des fichiers admin
    // d'après le token ; renouvelé au besoin). Sans compte : requête anonyme.
    const account = getActiveAccount()
    let status: number
    let body: () => Promise<unknown>
    if (account) {
      const r = await authedRequest(url, {}, account.uuid)
      if (r.kind !== 'response') return []        // hors ligne / session fermée
      status = r.res.status
      body   = () => r.res.json()
    } else {
      const res = await ekFetch(url)
      status = res.status
      body   = () => res.json()
    }
    if (status < 200 || status >= 300) return []
    const parsed = await body()
    if (!Array.isArray(parsed)) return []
    const data = parsed as CatalogueEntry[]

    const optional = data.filter(f =>
      f.path?.startsWith('modoptionnel/') ||
      f.path?.startsWith('modadmin/')
    )
    // Un catalogue par canal : celui de la beta ne doit pas remplacer celui du jeu
    // (il alimenterait les paliers et les compteurs du mauvais mode).
    if (optional.length > 0) store.set(catalogueKey(dev), optional.map(f => f.path))
    return optional
  } catch {
    // Hors ligne : le dernier catalogue connu reste en place.
    return []
  }
}

const catalogueKey = (beta: boolean) =>
  (beta ? 'knownOptionalModsBeta' : 'knownOptionalMods') as 'knownOptionalModsBeta' | 'knownOptionalMods'

/**
 * Liste de mods réellement activée pour un profil.
 * Les mods admin ne dépendent jamais du palier : ce sont des outils de
 * modération, ils restent pilotés à la main depuis l'onglet Mods.
 */
function effectiveMods(profile: LaunchProfile): string[] {
  if (profile.mods !== null) return profile.mods

  const catalogue = (store.get(catalogueKey(profile.beta === true)) as string[]) ?? []
  const enabled   = (store.get('enabledOptionalMods') as string[]) ?? []

  // Catalogue jamais récupéré (premier démarrage hors ligne) : on ne touche à
  // rien plutôt que de vider la sélection du joueur.
  if (catalogue.length === 0) return enabled

  return modsForLevel(catalogue, profile.perfLevel, enabled.filter(m => m.startsWith('modadmin/')))
}

/** Répercute le profil actif sur les clés globales du store. */
function applyActiveProfile(): LaunchProfile {
  const profile = getActiveProfile()
  store.set('ram',                 profile.ram)
  store.set('resolutionWidth',     profile.resW)
  store.set('resolutionHeight',    profile.resH)
  store.set('javaPath',            profile.javaPath)
  store.set('enabledOptionalMods', effectiveMods(profile))
  return profile
}

/**
 * Identifiant unique de profil.
 *
 * Surtout pas d'horodatage : deux profils créés dans la même milliseconde
 * recevraient le même identifiant, et le second écraserait silencieusement le
 * premier à l'enregistrement. Un UUID rend la collision impossible par
 * construction, sans avoir à inspecter les profils déjà enregistrés.
 */
function newProfileId(): string {
  return `profile-${randomUUID()}`
}

/**
 * Nom libre pour un nouveau profil personnalisé : « Personnalisé », puis
 * « Personnalisé 2 », etc. Un joueur qui bricole plusieurs fois se retrouve
 * avec des profils distincts au lieu d'écraser le précédent.
 */
function nextCustomName(profiles: LaunchProfile[]): string {
  const base = 'Personnalisé'
  if (!profiles.some(p => p.name === base)) return base
  let n = 2
  while (profiles.some(p => p.name === `${base} ${n}`)) n++
  return `${base} ${n}`
}

/**
 * Applique une modification au profil actif.
 *
 * Les trois paliers intégrés sont des points de repère : ils ne changent
 * jamais. Toucher un réglage alors que l'un d'eux est actif crée donc un
 * profil personnalisé qui en dérive et devient actif - le palier d'origine
 * reste disponible tel quel, et le joueur peut y revenir d'un clic.
 */
function updateActiveProfile(patch: Partial<LaunchProfile>): { profile: LaunchProfile; created: boolean } {
  const active   = getActiveProfile()
  const profiles = profilesOfChannel()

  if (!active.builtin) {
    const updated = { ...active, ...patch, id: active.id, builtin: false }
    saveProfile(updated)
    applyActiveProfile()
    return { profile: updated, created: false }
  }

  const derived: LaunchProfile = {
    ...active,
    ...patch,
    id:      newProfileId(),
    name:    nextCustomName(profiles),
    builtin: false,
    beta:    isBetaChannel(),
    // Le profil dérivé fige ce que le joueur avait sous les yeux : sans ça, sa
    // liste de mods bougerait au prochain rafraîchissement du catalogue.
    mods:    patch.mods ?? effectiveMods(active),
  }
  saveProfile(derived)
  setActiveProfileId(derived.id)
  applyActiveProfile()
  wlog(`Profil « ${derived.name} » créé depuis le palier ${active.perfLevel}`)
  return { profile: derived, created: true }
}

function saveProfile(profile: LaunchProfile): void {
  const profiles = [...((store.get('launchProfiles') as LaunchProfile[]) ?? [])]
  const idx = profiles.findIndex(p => p.id === profile.id)
  if (idx >= 0) profiles[idx] = profile
  else profiles.push(profile)
  store.set('launchProfiles', profiles)
}

let cachedHardware: Awaited<ReturnType<typeof detectHardware>> | null = null

ipcMain.handle('perf:hardware', async () => {
  if (!cachedHardware) {
    cachedHardware = await detectHardware()
    wlog(`Matériel : ${cachedHardware.cpuCores} threads, ${cachedHardware.totalRamGB} Go, GPU ${cachedHardware.gpuName ?? 'inconnu'} (${cachedHardware.gpuKind}) → palier ${cachedHardware.recommended}`)
  }
  return cachedHardware
})

/** true tant que le joueur n'a pas répondu à la proposition de palier. */
ipcMain.handle('perf:needsSetup', () => !(store.get('perfConfigured') as boolean))

/** Le joueur accepte un palier : il devient le profil actif. */
ipcMain.handle('perf:chooseLevel', (_e, level: string) => {
  if (!isPerfLevel(level)) return { ok: false }
  setActiveProfileId(builtinIdFor(level))
  store.set('perfConfigured', true)
  const profile = applyActiveProfile()
  wlog(`Palier choisi : ${level} (RAM ${profile.ram} Go, ${effectiveMods(profile).length} mods optionnels)`)
  return { ok: true, profile }
})

/** Le joueur ferme la proposition sans choisir : on ne la représente plus. */
ipcMain.handle('perf:dismissSetup', () => {
  store.set('perfConfigured', true)
})

/** Métadonnées des paliers, pour l'affichage (labels, descriptions, RAM conseillée). */
ipcMain.handle('perf:levels', () => {
  const totalRamGB = Math.floor(totalmem() / 1024 / 1024 / 1024)
  return PERF_LEVELS.map(level => ({
    level,
    label:       LEVEL_LABELS[level],
    desc:        LEVEL_DESCS[level],
    ram:         recommendedRam(level, totalRamGB),
    gameOptions: gameOptionsFor(level),
  }))
})

/** Réglages graphiques effectifs du profil actif (palier + modifications manuelles). */
ipcMain.handle('perf:activeGameOptions', () => {
  const profile = getActiveProfile()
  return {
    values:    gameOptionsFor(profile.perfLevel, profile.gameOptions),
    defaults:  gameOptionsFor(profile.perfLevel),
    editable:  [...EDITABLE_GAME_KEYS],
    overridden: Object.keys(profile.gameOptions ?? {}),
  }
})

/**
 * Enregistre des réglages graphiques modifiés à la main. Une valeur identique
 * à celle du palier n'est pas stockée comme surcharge : le réglage continue
 * alors de suivre le palier si celui-ci change.
 */
ipcMain.handle('perf:setGameOptions', (_e, values: Record<string, string>) => {
  const active   = getActiveProfile()
  const defaults = gameOptionsFor(active.perfLevel)

  const overrides: Record<string, string> = {}
  for (const key of EDITABLE_GAME_KEYS) {
    const v = values[key]
    if (v !== undefined && v !== defaults[key]) overrides[key] = v
  }

  const { profile, created } = updateActiveProfile({
    gameOptions: Object.keys(overrides).length > 0 ? overrides : null,
  })
  return { profileId: profile.id, profileName: profile.name, created }
})

/** Palier de chaque mod du catalogue connu - alimente les badges de l'onglet Mods. */
ipcMain.handle('perf:modTiers', () => {
  const catalogue = (store.get(catalogueKey(isBetaChannel())) as string[]) ?? []
  return Object.fromEntries(catalogue.map(path => [path, modTier(path)]))
})

/**
 * Écrit les réglages graphiques du palier dans le options.txt des instances
 * existantes. Geste explicite et confirmé : on touche à un fichier qui
 * appartient au joueur (seules les clés de performance sont réécrites, les
 * raccourcis et volumes sont préservés - voir applyGameOptions).
 */
ipcMain.handle('perf:applyGameOptions', async () => {
  if (isRunning()) return { ok: false, error: 'Le jeu est en cours d\'exécution.' }

  const profile = getActiveProfile()
  const level   = profile.perfLevel

  const existing = existsSync(instanceDir()) ? [INSTANCE_NAME] : []
  if (existing.length === 0) {
    // Rien d'installé : les réglages seront écrits à la première installation
    // par launcherCore (needsInitialGameOptions).
    return { ok: true, applied: 0 }
  }

  let applied = 0
  for (const name of existing) {
    if (applyGameOptions(instanceDir(name), level, profile.gameOptions)) applied++
  }
  wlog(`Réglages graphiques (${profile.name}) appliqués à ${applied} instance(s)`)
  return { ok: true, applied }
})

// ── Lancement Minecraft ───────────────────────────────────────────────────────
ipcMain.handle('launch:start', async (_e, dev?: boolean) => {
  // Compte prêt à l'emploi : renouvelé si son token approche de l'expiration, et
  // jamais déconnecté sur une simple panne réseau (voir authService.getAccount).
  const account = await getAccount()
  if (!account) return { ok: false, error: 'Non connecté.' }

  // Réserve la session AVANT les appels réseau préalables : un double clic ne
  // peut plus déclencher deux autorisations de lancement concurrentes.
  if (!gameSession.acquire({ uuid: account.uuid, username: account.username })) {
    return { ok: false, error: 'Minecraft est déjà en cours d\'exécution.' }
  }

  try {
    return await prepareAndLaunch(account, dev === true)
  } finally {
    // Échec avant le démarrage du processus : on rend la session. Une fois le
    // jeu lancé, c'est launcherCore qui la libère à sa fermeture.
    if (!gameSession.isRunning()) gameSession.release()
  }
})

/**
 * Préparation puis démarrage du jeu pour `account`.
 *
 * Le jeu ne dépend pas de la session web du launcher après son démarrage : il
 * n'emporte que le jeton de lancement à usage unique. Déconnexion, expiration ou
 * renouvellement du token launcher, ou changement de compte, n'ont donc aucun
 * effet sur lui - et inversement, sa fermeture ne touche pas aux comptes.
 */
async function prepareAndLaunch(account: Account, dev: boolean): Promise<{ ok: boolean; error?: string }> {
  // Le catalogue est réactualisé juste avant le lancement : c'est lui qui
  // détermine la liste de mods du palier, et il peut avoir bougé côté serveur.
  // Lancé en parallèle du GameAuthToken ci-dessous - les deux appels sont
  // indépendants, pas besoin de payer deux allers-retours réseau à la suite
  // avant de démarrer la JVM. fetchModCatalogue() avale déjà ses propres
  // erreurs (retourne [] en cas d'échec), donc rien à catcher ici.
  const catalogueFetch = fetchModCatalogue(dev)

  // GameAuthToken : preuve à usage unique (12 h côté Web) que le Web autorise CE lancement,
  // demandée au dernier moment (pas au login). Si le Web est injoignable ou
  // refuse, on n'initie PAS le lancement de Minecraft - jamais de jeton de
  // secours local, jamais de succès simulé.
  let gameAuthToken: string
  try {
    const gameAuth = await getGameAuthToken(account.uuid)
    gameAuthToken = gameAuth.token
  } catch (err: any) {
    const message = err?.message ?? 'Impossible d\'autoriser le lancement auprès du serveur.'
    wlog(`Launch: échec autorisation - ${message}`)
    return { ok: false, error: message }
  }

  await catalogueFetch

  // Le compte a pu être déconnecté pendant la préparation : on ne démarre pas le
  // jeu au nom d'une session que l'utilisateur vient de fermer. On repart des
  // identifiants à jour (le token a pu être renouvelé entre-temps).
  const current = getAccountByUuid(account.uuid)
  if (!current) {
    wlog('Launch: abandon - session fermée pendant la préparation')
    return { ok: false, error: 'Session fermée pendant la préparation du lancement. Reconnecte-toi pour jouer.' }
  }

  // Le lancement utilise les profils de son propre canal, quel que soit celui
  // affiché dans l'onglet Mods ; les clés globales lues par launcherCore (mods,
  // RAM…) sont donc recalculées pour ce canal avant de démarrer.
  const previousChannel = isBetaChannel()
  setBetaChannel(dev)
  const profile = applyActiveProfile()
  setBetaChannel(previousChannel)

  wlog(`Launch: démarrage - user=${current.username} profil=${profile.name} palier=${profile.perfLevel} ram=${profile.ram}Go java=${profile.javaPath ?? 'embarqué'}${dev ? ' [DEV]' : ''}`)
  logBuffer.length = 0  // vide le buffer au nouveau lancement
  launchStartTime = Date.now()
  launchPhase = { dev, gameStarted: false, hadDownload: false, lastProgress: null }

  const result = startLaunch(
    current,
    profile,

    (progress) => {
      if (progress.event !== 'speed') {
        launchPhase.lastProgress = progress
        if (progress.event !== 'check') launchPhase.hadDownload = true
      }
      mainWindow?.webContents.send('launch:progress', progress)
    },

    (line) => {
      if (!launchPhase.gameStarted) {
        launchPhase.gameStarted = true
        // Le process du jeu est détaché (voir launcherCore.ts) : il survit même
        // si le launcher se ferme complètement.
        if (store.get('closeOnLaunch') as boolean) { allowClose(); app.quit() }
        else mainWindow?.minimize()
      }
      logBuffer.push(line)
      if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift()
      mainWindow?.webContents.send('launch:log', { line })
    },

    (code) => {
      const elapsed  = Date.now() - launchStartTime
      const totalMin = Math.floor(elapsed / 60000)
      const h        = Math.floor(totalMin / 60)
      const m        = totalMin % 60
      const timeStr  = h > 0 ? `${h}h ${m}min` : `${totalMin}min`
      wlog(`Launch: fermé - code=${code} - durée=${timeStr}`)
      mainWindow?.webContents.send('launch:close', { code, duration: timeStr })
      mainWindow?.webContents.send('launch:state', { running: false })
      if (mainWindow?.isMinimized()) { mainWindow.restore(); mainWindow.focus() }
    },

    (message) => {
      wlog(`Launch: erreur - ${message}`)
      mainWindow?.webContents.send('launch:error', { message })
      mainWindow?.webContents.send('launch:state', { running: false })
      if (mainWindow?.isMinimized()) { mainWindow.restore(); mainWindow.focus() }
    },

    dev,
    gameAuthToken
  )

  if (result.ok) {
    mainWindow?.webContents.send('launch:state', { running: true, dev })
  }

  return result
}

ipcMain.on('launch:stop', () => stopLaunch())

// busy : vrai dès la réservation, y compris pendant l'autorisation réseau
// préalable (avant que isRunning() ne le devienne).
ipcMain.handle('launch:status', () => ({
  busy:         gameSession.isBusy(),
  dev:          launchPhase.dev,
  gameStarted:  launchPhase.gameStarted,
  hadDownload:  launchPhase.hadDownload,
  lastProgress: launchPhase.lastProgress,
}))

// ── Maintenance : force le retéléchargement des mods ──────────────────────────
// Ne supprime QUE le dossier mods/ de chaque instance connue (jamais saves/,
// options.txt, resourcepacks/... - mc-java-core retéléchargera les mods
// manquants au prochain lancement). Corrige le cas d'un fichier corrompu sans
// perte de progression du joueur.
ipcMain.handle('repair:mods', async () => {
  if (isRunning()) return { ok: false, error: 'Le jeu est en cours d\'exécution.' }

  if (mainWindow) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Annuler', 'Confirmer'],
      defaultId: 0,
      cancelId: 0,
      title: 'Réparer l\'installation',
      message: 'Retélécharger tous les mods au prochain lancement ?',
      detail: 'Tes mondes, captures d\'écran et réglages ne sont pas touchés. Seuls les fichiers de mods sont supprimés et seront retéléchargés.',
    })
    if (response !== 1) return { ok: false, cancelled: true }
  }

  let removed = 0
  const modsDir = join(instanceDir(), 'mods')
  if (existsSync(modsDir)) {
    try { rmSync(modsDir, { recursive: true, force: true }); removed++ } catch { /* ignore */ }
  }
  wlog(`Réparation : dossiers mods supprimés (${removed})`)
  return { ok: true }
})

// ── Démarrage automatique avec Windows ────────────────────────────────────────
ipcMain.handle('system:getStartupEnabled', () => app.getLoginItemSettings().openAtLogin)
ipcMain.handle('system:setStartupEnabled', (_e, enabled: boolean) => {
  app.setLoginItemSettings({ openAtLogin: enabled })
})

// ── Logs ─────────────────────────────────────────────────────────────────────
ipcMain.handle('logs:getAll',  () => [...logBuffer])
ipcMain.handle('logs:openDir', () => {
  // Les logs Minecraft sont dans <gameRoot>/instances/<instance>/logs/
  shell.openPath(join(instanceDir(), 'logs'))
})

// ── Mods optionnels ───────────────────────────────────────────────────────────
ipcMain.handle('mods:getOptional', (_e, dev?: boolean) => fetchModCatalogue(dev === true))

ipcMain.handle('mods:getEnabled', () => effectiveMods(getActiveProfile()))

/**
 * Enregistre une sélection manuelle de mods.
 *
 * Les trois profils intégrés définissent leur sélection à partir du palier et
 * ne sont pas modifiables : toucher aux mods depuis l'un d'eux crée un profil
 * personnalisé dérivé, qui devient actif. Le joueur garde ainsi les paliers de
 * référence intacts et peut y revenir.
 */
ipcMain.handle('mods:setEnabled', (_e, paths: string[]) => {
  const { profile, created } = updateActiveProfile({ mods: paths })
  return { profileId: profile.id, profileName: profile.name, created }
})

// ── Sélecteur de fichier ──────────────────────────────────────────────────────
ipcMain.handle('dialog:openFile', async (_e, filters?: Electron.FileFilter[]) => {
  if (!mainWindow) return null
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters ?? [{ name: 'Exécutable Java', extensions: ['exe', ''] }],
  })
  return canceled ? null : (filePaths[0] ?? null)
})

// ── Version applicaton ────────────────────────────────────────────────────────
ipcMain.handle('app:version', () => app.getVersion())

// ── RAM système ───────────────────────────────────────────────────────────────
ipcMain.handle('system:totalRam', () => Math.floor(totalmem() / 1024 / 1024 / 1024))

// ── Patch notes ───────────────────────────────────────────────────────────────
// Les patch notes sont des articles filtrés depuis l'API news
ipcMain.handle('patchnotes:load', async () => {
  try {
    const res = await ekFetch('https://earthkingdoms-mc.fr/api/news?filter=patch-note&limit=10')
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
})

// ── Profils de lancement ──────────────────────────────────────────────────────
/**
 * Bascule le canal (jeu / beta) dont les profils sont exposés. Piloté par le
 * sélecteur de l'onglet Mods ; le lancement fixe lui-même son canal.
 */
ipcMain.handle('profiles:setChannel', (_e, beta: boolean) => {
  setBetaChannel(beta === true)
  // Pendant un lancement, les clés globales appartiennent au canal lancé.
  if (!isRunning()) applyActiveProfile()
})

ipcMain.handle('profiles:list', () => {
  const profiles = profilesOfChannel()
  const activeId = getActiveProfileId()
  // Nombre de mods réellement actifs par profil - affiché dans le sélecteur.
  const modCounts = Object.fromEntries(profiles.map(p => [p.id, effectiveMods(p).length]))
  return { profiles, activeId, modCounts }
})

/**
 * Modifie le profil actif (RAM, résolution, Java). Sur un palier intégré, cela
 * crée un profil personnalisé - voir updateActiveProfile.
 */
ipcMain.handle('profiles:update', (_e, patch: Partial<LaunchProfile>) => {
  const safe: Partial<LaunchProfile> = {}
  if (STORE_KEYS.ram(patch.ram))               safe.ram  = patch.ram as number
  if (STORE_KEYS.resolutionWidth(patch.resW))  safe.resW = patch.resW as number
  if (STORE_KEYS.resolutionHeight(patch.resH)) safe.resH = patch.resH as number
  if ('javaPath' in patch && STORE_KEYS.javaPath(patch.javaPath ?? null)) safe.javaPath = patch.javaPath ?? null
  const { profile, created } = updateActiveProfile(safe)
  return { profile, created }
})

/** Renomme un profil personnalisé. Les paliers intégrés gardent leur nom. */
ipcMain.handle('profiles:rename', (_e, id: string, name: string) => {
  const profiles = (store.get('launchProfiles') as LaunchProfile[]) ?? []
  const profile  = profiles.find(p => p.id === id)
  if (!profile || profile.builtin || !name.trim()) return
  saveProfile({ ...profile, name: name.trim() })
})

/**
 * Crée un profil personnalisé à partir d'un profil existant (souvent un palier
 * intégré) et l'active. C'est le seul chemin pour obtenir un profil modifiable.
 */
ipcMain.handle('profiles:create', (_e, name: string, sourceId: string) => {
  const profiles = profilesOfChannel()
  const source   = profiles.find(p => p.id === sourceId) ?? getActiveProfile()
  const created: LaunchProfile = {
    ...source,
    id:      newProfileId(),
    name:    name.trim() || nextCustomName(profiles),
    builtin: false,
    beta:    isBetaChannel(),
    // Fige la sélection courante du profil source : le profil perso part de ce
    // que le joueur voyait, et ne bougera plus tout seul.
    mods:    effectiveMods(source),
  }
  saveProfile(created)
  setActiveProfileId(created.id)
  applyActiveProfile()
  return created
})

ipcMain.handle('profiles:delete', (_e, id: string) => {
  // Les paliers intégrés sont les points de repère du système - jamais supprimables.
  if ((BUILTIN_PROFILE_IDS as readonly string[]).includes(id)) return
  const profiles = ((store.get('launchProfiles') as LaunchProfile[]) ?? []).filter(p => p.id !== id)
  store.set('launchProfiles', profiles)
  if (getActiveProfileId() === id) {
    setActiveProfileId(fallbackProfileId())
    applyActiveProfile()
  }
})

/** Remet un profil personnalisé sur les mods et/ou les réglages de son palier. */
ipcMain.handle('profiles:reset', (_e, id: string, what: 'mods' | 'gameOptions' | 'all') => {
  const profiles = (store.get('launchProfiles') as LaunchProfile[]) ?? []
  const profile  = profiles.find(p => p.id === id)
  if (!profile || profile.builtin) return
  saveProfile({
    ...profile,
    mods:        what === 'gameOptions' ? profile.mods        : null,
    gameOptions: what === 'mods'        ? profile.gameOptions : null,
  })
  if (getActiveProfileId() === id) applyActiveProfile()
})

ipcMain.handle('profiles:setActive', (_e, id: string) => {
  // Refuse un profil de l'autre canal : il ne serait pas listé ni appliqué.
  if (!profilesOfChannel().some(p => p.id === id)) return applyActiveProfile()
  setActiveProfileId(id)
  return applyActiveProfile()
})

// ── Multicompte ────────────────────────────────────────────────────────────────
ipcMain.handle('auth:getAccounts', () => getAccounts())

ipcMain.handle('auth:switchAccount', (_e, uuid: unknown) => {
  if (typeof uuid !== 'string') return { ok: false }
  const account = switchAccount(uuid)
  // Le compte précédent reste enregistré avec son propre token ; seul le compte
  // actif change. Un jeu déjà lancé garde l'identité avec laquelle il a démarré.
  return account ? { ok: true, account: toPublic(account) } : { ok: false }
})

ipcMain.handle('auth:removeAccount', (_e, uuid: unknown) => {
  if (typeof uuid !== 'string') return { ok: false, nextAccount: null }
  const next = removeAccount(uuid)
  return { ok: true, nextAccount: toPublic(next) }
})

// ── Rapport de bug ──────────────────────────────────────────────────────────
ipcMain.handle('bug:captureScreen', async () => {
  if (!mainWindow) return null
  try {
    const img = await mainWindow.webContents.capturePage()
    return img.toDataURL()
  } catch {
    return null
  }
})

// ── Auto-update ───────────────────────────────────────────────────────────────

function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const l = parse(latest)
  const c = parse(current)
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    const lv = l[i] ?? 0
    const cv = c[i] ?? 0
    if (lv > cv) return true
    if (lv < cv) return false
  }
  return false
}

// Déclenché par le renderer au démarrage
// Retourne { available: boolean } ou { available: false, macUpdate: true, latestVersion, downloadUrl }
ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return { available: false }

  // macOS - auto-update désactivé (pas de signature Apple)
  // On vérifie quand même via l'API GitHub pour informer l'utilisateur
  if (process.platform === 'darwin') {
    try {
      const res = await Promise.race([
        net.fetch('https://api.github.com/repos/EarthKingdoms-MC/EarthKingdoms-Launcher/releases/latest', {
          headers: { 'User-Agent': `EarthKingdoms-Launcher/${app.getVersion()}` },
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ])
      if (!res.ok) return { available: false }
      const data = await res.json() as {
        tag_name: string
        assets: Array<{ name: string; browser_download_url: string }>
      }
      const latestVersion  = data.tag_name.replace(/^v/, '')
      const currentVersion = app.getVersion()
      if (!isNewerVersion(latestVersion, currentVersion)) return { available: false }
      // Une release contient un DMG par architecture : on propose celui de ce Mac.
      // (GitHub remplace les espaces des noms de fichiers par des points.)
      const dmgAssets = data.assets.filter(a => a.name.endsWith('.dmg'))
      const dmgAsset  = process.arch === 'arm64'
        ? dmgAssets.find(a => a.name.includes('arm64'))
        : dmgAssets.find(a => a.name.includes('x64')) ?? dmgAssets.find(a => !a.name.includes('arm64'))
      const downloadUrl = (dmgAsset ?? dmgAssets[0])?.browser_download_url
        ?? 'https://github.com/EarthKingdoms-MC/EarthKingdoms-Launcher/releases/latest'
      wlog(`macOS update: v${currentVersion} → v${latestVersion}`)
      return { available: false, macUpdate: true, latestVersion, downloadUrl }
    } catch {
      return { available: false }
    }
  }

  // Windows + Linux - electron-updater silencieux
  return new Promise<{ available: boolean }>((resolve) => {
    let done = false
    const finish = (available: boolean) => {
      if (done) return
      done = true
      resolve({ available })
    }

    autoUpdater.once('update-not-available', () => finish(false))
    autoUpdater.once('update-available',     () => finish(true))
    autoUpdater.once('error',                () => finish(false))

    // Fallback si pas de réponse en 8 secondes
    setTimeout(() => finish(false), 8000)

    autoUpdater.checkForUpdates()?.catch(() => finish(false))
  })
})
