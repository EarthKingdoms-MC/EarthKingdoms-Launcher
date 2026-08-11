import { app, BrowserWindow, dialog, ipcMain, net, shell, Notification } from 'electron'
import { join }    from 'path'

// Permet l'autoplay audio sans geste utilisateur → préchauffage pipeline au démarrage
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync, rmSync, existsSync } from 'fs'
import { totalmem } from 'os'
import { request as httpsRequest } from 'https'
import { randomUUID } from 'crypto'
import { store, migrateProfiles, getActiveProfile, BUILTIN_PROFILE_IDS } from './store'
import {
  modsForLevel, modTier, applyGameOptions, gameOptionsFor, EDITABLE_GAME_KEYS,
  LEVEL_LABELS, LEVEL_DESCS, PERF_LEVELS, isPerfLevel, recommendedRam,
} from './perfProfiles'
import { detectHardware } from './hardware'
import { login, logout, getAccount, getActiveAccount, getAccounts, switchAccount, removeAccount, getLauncherUA } from './auth'

/** net.fetch avec User-Agent launcher - permet le bypass Cloudflare bot protection */
function ekFetch(url: string, init?: Parameters<typeof net.fetch>[1]): ReturnType<typeof net.fetch> {
  const headers = new Headers(init?.headers)
  headers.set('User-Agent', getLauncherUA())
  return net.fetch(url, { ...init, headers })
}
import { startLaunch, stopLaunch, isRunning } from './launcherCore'
import { autoUpdater } from 'electron-updater'
import type { Account, LaunchProfile } from './store'

let mainWindow: BrowserWindow | null = null
let launchStartTime = 0

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
  const dir = join(app.getPath('userData'), 'EarthKingdoms', 'logs')
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
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1024,
    minHeight: 640,
    frame: false,
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
  initLauncherLog()
  wlog(`Launcher démarré - v${app.getVersion()}`)

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
      wlog(`Mise à jour téléchargée : ${(info as any)?.version ?? '?'} - redémarrage…`)
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
ipcMain.on('open:external', (_e, url: string) => shell.openExternal(url))

// ── Persistance (electron-store) ─────────────────────────────────────────────
ipcMain.handle('store:get', (_e, key: string) => store.get(key as keyof typeof store.store))
ipcMain.handle('store:set', (_e, key: string, value: unknown) => {
  store.set(key as keyof typeof store.store, value as never)
})

// ── Authentification EarthKingdoms ───────────────────────────────────────────
ipcMain.handle('auth:login', async (_e, username: string, password: string) => {
  const result = await login(username, password)
  if ((result as any)?.ok) wlog(`Auth: connexion réussie - ${username}`)
  else wlog(`Auth: échec connexion - ${username}`)
  return result
})

ipcMain.handle('auth:getAccount', async () => {
  return getAccount()
})

ipcMain.handle('auth:logout', () => {
  logout()
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
  try {
    const res = await ekFetch('https://earthkingdoms-mc.fr/api/launcher/player', {
      headers: { Authorization: `Bearer ${account.token}` },
    })
    if (!res.ok) return { ok: false, error: `Erreur serveur (${res.status})` }
    const data = await res.json() as Record<string, unknown> | null

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
    return { ok: false, error: 'Erreur réseau.' }
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

// ── Skin (contourne CSP/CORS) ─────────────────────────────────────────────────
ipcMain.handle('skin:load', async (_e, username: string) => {
  // Source de vérité : l'URL du skin marqué is_current dans l'historique
  const account = getActiveAccount()
  if (account) {
    try {
      const histRes = await ekFetch('https://earthkingdoms-mc.fr/api/skin/history/list', {
        headers: { Authorization: `Bearer ${account.token}` },
        cache: 'no-store',
      })
      if (histRes.ok) {
        const data = await histRes.json() as { history: Array<{ id: string | number; skin_url: string; is_current: boolean }> }
        const current = data.history?.find(h => h.is_current)
        if (current?.skin_url) {
          const fullUrl = current.skin_url.startsWith('http')
            ? current.skin_url
            : `https://earthkingdoms-mc.fr${current.skin_url}`
          const res = await ekFetch(`${fullUrl}?t=${Date.now()}`, { cache: 'no-store' })
          if (res.ok) {
            const buf = await res.arrayBuffer()
            return `data:image/png;base64,${Buffer.from(buf).toString('base64')}`
          }
        }
      }
    } catch { /* fallback ci-dessous */ }
  }
  // Fallback : URL basée sur le username
  try {
    const res = await ekFetch(`https://earthkingdoms-mc.fr/skins/${username}.png?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    return `data:image/png;base64,${Buffer.from(buf).toString('base64')}`
  } catch {
    return null
  }
})

ipcMain.handle('skin:loadUrl', async (_e, url: string) => {
  try {
    const fullUrl = url.startsWith('http') ? url : `https://earthkingdoms-mc.fr${url}`
    const res = await ekFetch(`${fullUrl}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    return `data:image/png;base64,${Buffer.from(buf).toString('base64')}`
  } catch {
    return null
  }
})

ipcMain.handle('skin:historyList', async () => {
  const account = getActiveAccount()
  if (!account) return { ok: false, error: 'Non connecté.' }
  try {
    const res = await ekFetch('https://earthkingdoms-mc.fr/api/skin/history/list', {
      headers: { Authorization: `Bearer ${account.token}` },
    })
    if (!res.ok) return { ok: false, error: `Erreur serveur (${res.status})` }
    const data = await res.json() as { history: Array<{ id: string | number; skin_url: string; created_at: string | null; is_current: boolean }> }
    return { ok: true, history: data.history }
  } catch {
    return { ok: false, error: 'Erreur réseau.' }
  }
})

ipcMain.handle('skin:historyRestore', async (_e, historyId: string) => {
  const account = getActiveAccount()
  if (!account) return { ok: false, error: 'Non connecté.' }
  try {
    const res = await ekFetch(`https://earthkingdoms-mc.fr/api/skin/history/restore/${encodeURIComponent(historyId)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${account.token}` },
    })
    wlog(`SkinHistory: restore ${historyId} - HTTP ${res.status}`)
    if (res.ok) return { ok: true }
    let msg = `Erreur serveur (${res.status})`
    try { msg = (await res.json() as { error?: string }).error ?? msg } catch {}
    return { ok: false, error: msg }
  } catch {
    return { ok: false, error: 'Erreur réseau.' }
  }
})

ipcMain.handle('skin:upload', async (_e, fileData: number[]) => {
  const account = getActiveAccount()
  if (!account) return { ok: false, error: 'Non connecté. Reconnecte-toi dans le launcher.' }

  const now = Math.floor(Date.now() / 1000)
  wlog(`Skin: user=${account.username} token=${account.token?.slice(0, 10)}... expires=${account.tokenExpires} (dans ${account.tokenExpires - now}s)`)

  try {
    const boundary   = `----EKBoundary${Date.now()}`
    const fileBuffer = Buffer.from(new Uint8Array(fileData))
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="skin"; filename="${account.username}.png"\r\n` +
        `Content-Type: image/png\r\n\r\n`
      ),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])

    // Utilise https natif Node.js - évite les bugs de net.fetch avec Buffer + headers custom
    const { status, text } = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = httpsRequest(
        'https://earthkingdoms-mc.fr/api/skin/upload',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${account.token}`,
            'Content-Type':  `multipart/form-data; boundary=${boundary}`,
            'Content-Length': String(body.length),
            'User-Agent':    getLauncherUA(),
          },
        },
        (res) => {
          let data = ''
          res.on('data', (chunk: Buffer) => { data += chunk.toString() })
          res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }))
        }
      )
      req.on('error', reject)
      req.write(body)
      req.end()
    })

    wlog(`Skin: réponse serveur - HTTP ${status} - ${text.slice(0, 200)}`)
    if (status >= 200 && status < 300) {
      wlog(`Skin: upload réussi - ${account.username}`)
      return { ok: true }
    }
    let msg = `Erreur serveur (${status})`
    try { msg = (JSON.parse(text) as { error?: string }).error ?? msg } catch { /* silencieux */ }
    wlog(`Skin: upload échoué - ${msg}`)
    return { ok: false, error: msg }
  } catch (e) {
    wlog(`Skin: erreur réseau - ${e}`)
    return { ok: false, error: 'Erreur réseau.' }
  }
})

// ── Paliers de performance ────────────────────────────────────────────────────
//
// Le profil actif est la source de vérité (palier, RAM, résolution, Java,
// sélection de mods). Les clés globales du store restent alimentées à partir de
// lui : plusieurs endroits du launcher les lisent encore directement (Footer,
// patch fetch de launcherCore, écran de paramètres).

const INSTANCE_NAMES = ['EarthKingdoms', 'EarthKingdoms-dev']

interface CatalogueEntry { url: string; size: number; hash: string; path: string }

/**
 * Récupère la liste des mods optionnels et la mémorise.
 *
 * Le catalogue est indispensable aux paliers : sans lui, on ne sait pas quels
 * mods existent, donc pas lesquels activer. Il est donc rafraîchi au démarrage
 * et avant chaque lancement, pas seulement à l'ouverture de l'onglet Mods.
 */
async function fetchModCatalogue(): Promise<CatalogueEntry[]> {
  try {
    const account = getActiveAccount()
    const headers: Record<string, string> = {}
    if (account?.token) headers['Authorization'] = `Bearer ${account.token}`

    const res = await ekFetch('https://earthkingdoms-mc.fr/launcher/files/?instance=EarthKingdomsV4-beta', { headers })
    if (!res.ok) return []
    const data = await res.json() as CatalogueEntry[]

    const optional = data.filter(f =>
      f.path?.startsWith('modoptionnel/') ||
      f.path?.startsWith('modadmin/')
    )
    if (optional.length > 0) store.set('knownOptionalMods', optional.map(f => f.path))
    return optional
  } catch {
    // Hors ligne : le dernier catalogue connu reste en place.
    return []
  }
}

function instanceDir(name: string): string {
  return join(app.getPath('userData'), 'EarthKingdoms', 'instances', name)
}

/**
 * Liste de mods réellement activée pour un profil.
 * Les mods admin ne dépendent jamais du palier : ce sont des outils de
 * modération, ils restent pilotés à la main depuis l'onglet Mods.
 */
function effectiveMods(profile: LaunchProfile): string[] {
  if (profile.mods !== null) return profile.mods

  const catalogue = (store.get('knownOptionalMods')   as string[]) ?? []
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
  const profiles = (store.get('launchProfiles') as LaunchProfile[]) ?? []

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
    // Le profil dérivé fige ce que le joueur avait sous les yeux : sans ça, sa
    // liste de mods bougerait au prochain rafraîchissement du catalogue.
    mods:    patch.mods ?? effectiveMods(active),
  }
  saveProfile(derived)
  store.set('activeProfileId', derived.id)
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
    wlog(`Matériel : ${cachedHardware.cpuCores} coeurs, ${cachedHardware.totalRamGB} Go, GPU ${cachedHardware.gpuName ?? 'inconnu'} (${cachedHardware.gpuKind}) → palier ${cachedHardware.recommended}`)
  }
  return cachedHardware
})

/** true tant que le joueur n'a pas répondu à la proposition de palier. */
ipcMain.handle('perf:needsSetup', () => !(store.get('perfConfigured') as boolean))

/** Le joueur accepte un palier : il devient le profil actif. */
ipcMain.handle('perf:chooseLevel', (_e, level: string) => {
  if (!isPerfLevel(level)) return { ok: false }
  store.set('activeProfileId', `perf-${level}`)
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
  const catalogue = (store.get('knownOptionalMods') as string[]) ?? []
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

  const existing = INSTANCE_NAMES.filter(n => existsSync(instanceDir(n)))
  if (existing.length === 0) {
    // Rien d'installé : les réglages seront écrits à la première installation
    // par launcherCore (needsInitialGameOptions).
    return { ok: true, applied: 0 }
  }

  if (mainWindow) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Annuler', 'Appliquer'],
      defaultId: 1,
      cancelId: 0,
      title: 'Réglages graphiques',
      message: `Appliquer les réglages graphiques de « ${profile.name} » au jeu ?`,
      detail: 'Distance d\'affichage, particules, nuages, ombres et mipmaps sont remplacés. '
            + 'Tes raccourcis clavier, volumes et autres réglages ne sont pas touchés.',
    })
    if (response !== 1) return { ok: false, cancelled: true }
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
  const account = await getAccount()
  if (!account) return { ok: false, error: 'Non connecté.' }

  // Le catalogue est réactualisé juste avant le lancement : c'est lui qui
  // détermine la liste de mods du palier, et il peut avoir bougé côté serveur.
  await fetchModCatalogue()
  const profile = applyActiveProfile()

  wlog(`Launch: démarrage - user=${account.username} profil=${profile.name} palier=${profile.perfLevel} ram=${profile.ram}Go java=${profile.javaPath ?? 'embarqué'}${dev ? ' [DEV]' : ''}`)
  logBuffer.length = 0  // vide le buffer au nouveau lancement
  launchStartTime = Date.now()
  let gameStarted = false

  const result = startLaunch(
    account,
    profile,

    (progress) => mainWindow?.webContents.send('launch:progress', progress),

    (line) => {
      if (!gameStarted) {
        gameStarted = true
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
      mainWindow?.webContents.send('launch:close', { code })
      mainWindow?.webContents.send('launch:state', { running: false })
      if (mainWindow?.isMinimized()) { mainWindow.restore(); mainWindow.focus() }
      if (Notification.isSupported()) {
        new Notification({
          title: 'EarthKingdoms',
          body:  `Minecraft fermé · Temps de jeu : ${timeStr}`,
        }).show()
      }
    },

    (message) => {
      wlog(`Launch: erreur - ${message}`)
      mainWindow?.webContents.send('launch:error', { message })
      mainWindow?.webContents.send('launch:state', { running: false })
      if (mainWindow?.isMinimized()) { mainWindow.restore(); mainWindow.focus() }
    },

    dev === true
  )

  if (result.ok) {
    mainWindow?.webContents.send('launch:state', { running: true, dev: dev === true })
  }

  return result
})

ipcMain.on('launch:stop', () => stopLaunch())

ipcMain.handle('launch:isRunning', () => isRunning())

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

  const basePath = join(app.getPath('userData'), 'EarthKingdoms', 'instances')
  let removed = 0
  for (const instance of ['EarthKingdoms', 'EarthKingdoms-dev']) {
    const modsDir = join(basePath, instance, 'mods')
    if (existsSync(modsDir)) {
      try { rmSync(modsDir, { recursive: true, force: true }); removed++ } catch { /* ignore */ }
    }
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
  // Les logs Minecraft sont dans basePath/instances/EarthKingdoms/logs/
  shell.openPath(join(app.getPath('userData'), 'EarthKingdoms', 'instances', 'EarthKingdoms', 'logs'))
})

// ── Mods optionnels ───────────────────────────────────────────────────────────
ipcMain.handle('mods:getOptional', () => fetchModCatalogue())

ipcMain.handle('mods:getEnabled', () => {
  return (store.get('enabledOptionalMods') as string[]) ?? []
})

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
ipcMain.handle('profiles:list', () => {
  const profiles = (store.get('launchProfiles') as LaunchProfile[]) ?? []
  const activeId = (store.get('activeProfileId') as string) ?? 'perf-medium'
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
  if (typeof patch.ram      === 'number') safe.ram      = patch.ram
  if (typeof patch.resW     === 'number') safe.resW     = patch.resW
  if (typeof patch.resH     === 'number') safe.resH     = patch.resH
  if ('javaPath' in patch)                safe.javaPath = patch.javaPath ?? null
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
  const profiles = (store.get('launchProfiles') as LaunchProfile[]) ?? []
  const source   = profiles.find(p => p.id === sourceId) ?? getActiveProfile()
  const created: LaunchProfile = {
    ...source,
    id:      newProfileId(),
    name:    name.trim() || nextCustomName(profiles),
    builtin: false,
    // Fige la sélection courante du profil source : le profil perso part de ce
    // que le joueur voyait, et ne bougera plus tout seul.
    mods:    effectiveMods(source),
  }
  saveProfile(created)
  store.set('activeProfileId', created.id)
  applyActiveProfile()
  return created
})

ipcMain.handle('profiles:delete', (_e, id: string) => {
  // Les paliers intégrés sont les points de repère du système - jamais supprimables.
  if ((BUILTIN_PROFILE_IDS as readonly string[]).includes(id)) return
  const profiles = ((store.get('launchProfiles') as LaunchProfile[]) ?? []).filter(p => p.id !== id)
  store.set('launchProfiles', profiles)
  if ((store.get('activeProfileId') as string) === id) {
    store.set('activeProfileId', 'perf-medium')
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
  if ((store.get('activeProfileId') as string) === id) applyActiveProfile()
})

ipcMain.handle('profiles:setActive', (_e, id: string) => {
  store.set('activeProfileId', id)
  return applyActiveProfile()
})

// ── Multicompte ────────────────────────────────────────────────────────────────
ipcMain.handle('auth:getAccounts', () => getAccounts())

ipcMain.handle('auth:switchAccount', (_e, uuid: string) => {
  const account = switchAccount(uuid)
  return account ? { ok: true, account } : { ok: false }
})

ipcMain.handle('auth:removeAccount', (_e, uuid: string) => {
  const next = removeAccount(uuid)
  return { ok: true, nextAccount: next }
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
      const dmgAsset  = data.assets.find(a => a.name.endsWith('.dmg'))
      const downloadUrl = dmgAsset?.browser_download_url
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
