import { app, BrowserWindow, dialog, ipcMain, net, shell, Notification } from 'electron'
import { join }    from 'path'

// Permet l'autoplay audio sans geste utilisateur → préchauffage pipeline au démarrage
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { totalmem } from 'os'
import { request as httpsRequest } from 'https'
import { store }   from './store'
import { login, logout, getAccount, getActiveAccount, getAccounts, switchAccount, removeAccount } from './auth'
import { startLaunch, stopLaunch, isRunning } from './launcherCore'
import { autoUpdater } from 'electron-updater'
import type { Account, LaunchProfile } from './store'

let mainWindow: BrowserWindow | null = null
let launchStartTime = 0

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

// Buffer des logs MC — conservés entre navigations, effacés à chaque nouveau lancement
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
      sandbox: false,
      webviewTag: true,
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  initLauncherLog()
  wlog(`Launcher démarré — v${app.getVersion()}`)

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // Quand téléchargé → redémarre l'app pour appliquer (Windows + Linux uniquement)
  if (app.isPackaged && process.platform !== 'darwin') {
    autoUpdater.on('update-available',   (info) => wlog(`Mise à jour disponible : ${(info as any)?.version ?? '?'}`))
    autoUpdater.on('update-downloaded',  (info) => {
      wlog(`Mise à jour téléchargée : ${(info as any)?.version ?? '?'} — redémarrage…`)
      autoUpdater.quitAndInstall(true, true)
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
  if ((result as any)?.ok) wlog(`Auth: connexion réussie — ${username}`)
  else wlog(`Auth: échec connexion — ${username}`)
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

// ── News (scraping HTML, contourne CSP) ──────────────────────────────────────
ipcMain.handle('news:load', async () => {
  try {
    const res = await net.fetch('https://earthkingdoms-mc.fr/news/')
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
})

// ── Skin (contourne CSP/CORS) ─────────────────────────────────────────────────
ipcMain.handle('skin:load', async (_e, username: string) => {
  try {
    const res = await net.fetch(`https://earthkingdoms-mc.fr/skins/${username}.png?t=${Date.now()}`)
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
    const res = await net.fetch(`${fullUrl}?t=${Date.now()}`)
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
    const res = await net.fetch('https://earthkingdoms-mc.fr/api/skin/history/list', {
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
    const res = await net.fetch(`https://earthkingdoms-mc.fr/api/skin/history/restore/${encodeURIComponent(historyId)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${account.token}` },
    })
    wlog(`SkinHistory: restore ${historyId} — HTTP ${res.status}`)
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

    // Utilise https natif Node.js — évite les bugs de net.fetch avec Buffer + headers custom
    const { status, text } = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = httpsRequest(
        'https://earthkingdoms-mc.fr/api/skin/upload',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${account.token}`,
            'Content-Type':  `multipart/form-data; boundary=${boundary}`,
            'Content-Length': String(body.length),
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

    wlog(`Skin: réponse serveur — HTTP ${status} — ${text.slice(0, 200)}`)
    if (status >= 200 && status < 300) {
      wlog(`Skin: upload réussi — ${account.username}`)
      return { ok: true }
    }
    let msg = `Erreur serveur (${status})`
    try { msg = (JSON.parse(text) as { error?: string }).error ?? msg } catch { /* silencieux */ }
    wlog(`Skin: upload échoué — ${msg}`)
    return { ok: false, error: msg }
  } catch (e) {
    wlog(`Skin: erreur réseau — ${e}`)
    return { ok: false, error: 'Erreur réseau.' }
  }
})

// ── Lancement Minecraft ───────────────────────────────────────────────────────
ipcMain.handle('launch:start', () => {
  const account = getActiveAccount()
  if (!account) return { ok: false, error: 'Non connecté.' }

  const ram      = (store.get('ram')      as number)        || 4
  const javaPath = (store.get('javaPath') as string | null) || null

  wlog(`Launch: démarrage — user=${account.username} ram=${ram}Go java=${javaPath ?? 'embarqué'}`)
  logBuffer.length = 0  // vide le buffer au nouveau lancement
  launchStartTime = Date.now()
  let gameStarted = false

  const result = startLaunch(
    account,
    ram,
    javaPath,

    (progress) => mainWindow?.webContents.send('launch:progress', progress),

    (line) => {
      if (!gameStarted) {
        gameStarted = true
        mainWindow?.minimize()
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
      wlog(`Launch: fermé — code=${code} — durée=${timeStr}`)
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
      wlog(`Launch: erreur — ${message}`)
      mainWindow?.webContents.send('launch:error', { message })
      mainWindow?.webContents.send('launch:state', { running: false })
      if (mainWindow?.isMinimized()) { mainWindow.restore(); mainWindow.focus() }
    }
  )

  if (result.ok) {
    mainWindow?.webContents.send('launch:state', { running: true })
  }

  return result
})

ipcMain.on('launch:stop', () => stopLaunch())

ipcMain.handle('launch:isRunning', () => isRunning())

// ── Logs ─────────────────────────────────────────────────────────────────────
ipcMain.handle('logs:getAll',  () => [...logBuffer])
ipcMain.handle('logs:openDir', () => {
  // Les logs Minecraft sont dans basePath/instances/EarthKingdoms/logs/
  shell.openPath(join(app.getPath('userData'), 'EarthKingdoms', 'instances', 'EarthKingdoms', 'logs'))
})

// ── Mods optionnels ───────────────────────────────────────────────────────────
ipcMain.handle('mods:getOptional', async () => {
  try {
    const res = await net.fetch('https://earthkingdoms-mc.fr/launcher/files/?instance=EarthKingdomsV4-beta')
    if (!res.ok) return []
    const data = await res.json() as Array<{ url: string; size: number; hash: string; path: string }>
    return data.filter(f => f.path?.startsWith('modoptionnel/'))
  } catch {
    return []
  }
})

ipcMain.handle('mods:getEnabled', () => {
  return (store.get('enabledOptionalMods') as string[]) ?? []
})

ipcMain.handle('mods:setEnabled', (_e, paths: string[]) => {
  store.set('enabledOptionalMods', paths)
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
// Les patch notes sont des articles filtrés depuis la page news
ipcMain.handle('patchnotes:load', async () => {
  try {
    const res = await net.fetch('https://earthkingdoms-mc.fr/news/?filter=patch-note')
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
})

// ── Profils de lancement ──────────────────────────────────────────────────────
ipcMain.handle('profiles:list', () => {
  const profiles  = (store.get('launchProfiles')  as LaunchProfile[]) ?? [{ id: 'default', name: 'Défaut', ram: 4, resW: 854, resH: 480, javaPath: null }]
  const activeId  = (store.get('activeProfileId') as string)          ?? 'default'
  return { profiles, activeId }
})

ipcMain.handle('profiles:save', (_e, profile: LaunchProfile) => {
  const profiles = [...((store.get('launchProfiles') as LaunchProfile[]) ?? [])]
  const idx = profiles.findIndex(p => p.id === profile.id)
  if (idx >= 0) profiles[idx] = profile
  else profiles.push(profile)
  store.set('launchProfiles', profiles)
})

ipcMain.handle('profiles:delete', (_e, id: string) => {
  if (id === 'default') return
  let profiles = ((store.get('launchProfiles') as LaunchProfile[]) ?? []).filter(p => p.id !== id)
  if (!profiles.find(p => p.id === 'default')) {
    profiles = [{ id: 'default', name: 'Défaut', ram: 4, resW: 854, resH: 480, javaPath: null }, ...profiles]
  }
  store.set('launchProfiles', profiles)
  if ((store.get('activeProfileId') as string) === id) {
    store.set('activeProfileId', 'default')
  }
})

ipcMain.handle('profiles:setActive', (_e, id: string) => {
  store.set('activeProfileId', id)
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

  // macOS — auto-update désactivé (pas de signature Apple)
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

  // Windows + Linux — electron-updater silencieux
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
