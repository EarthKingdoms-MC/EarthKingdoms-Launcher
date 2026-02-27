import { app, BrowserWindow, ipcMain, net, shell } from 'electron'
import { join }    from 'path'
import { store }   from './store'
import { login, logout, getAccount } from './auth'
import { startLaunch, stopLaunch, isRunning } from './launcherCore'
import type { Account } from './store'

let mainWindow: BrowserWindow | null = null

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
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
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
  return login(username, password)
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
    const res = await net.fetch(`https://earthkingdoms-mc.fr/skins/${username}.png`)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    return `data:image/png;base64,${Buffer.from(buf).toString('base64')}`
  } catch {
    return null
  }
})

// ── Lancement Minecraft ───────────────────────────────────────────────────────
ipcMain.handle('launch:start', () => {
  const account = store.get('account') as Account | null
  if (!account) return { ok: false, error: 'Non connecté.' }

  const ram      = (store.get('ram')      as number)        || 4
  const javaPath = (store.get('javaPath') as string | null) || null

  logBuffer.length = 0  // vide le buffer au nouveau lancement
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
      mainWindow?.webContents.send('launch:close', { code })
      mainWindow?.webContents.send('launch:state', { running: false })
      if (mainWindow?.isMinimized()) { mainWindow.restore(); mainWindow.focus() }
    },

    (message) => {
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
