import { contextBridge, ipcRenderer } from 'electron'

// Garde une ref des wrappers pour que off() retrouve le bon listener IPC
const _wrappers = new Map<Function, (...args: any[]) => void>()

contextBridge.exposeInMainWorld('api', {
  // Fenêtre
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close:    () => ipcRenderer.send('window:close'),

  // Utilitaires
  openExternal: (url: string) => ipcRenderer.send('open:external', url),

  // Persistance
  storeGet: (key: string)                 => ipcRenderer.invoke('store:get', key),
  storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),

  // Authentification
  authLogin:      (username: string, password: string) => ipcRenderer.invoke('auth:login', username, password),
  authGetAccount: ()                                   => ipcRenderer.invoke('auth:getAccount'),
  authLogout:     ()                                   => ipcRenderer.invoke('auth:logout'),

  // Statut serveur
  serverStatus: () => ipcRenderer.invoke('server:status'),

  // Actualités
  newsLoad: () => ipcRenderer.invoke('news:load'),

  // Skin
  skinLoad: (username: string) => ipcRenderer.invoke('skin:load', username),

  // Lancement Minecraft
  launchStart:     () => ipcRenderer.invoke('launch:start'),
  launchStop:      () => ipcRenderer.send('launch:stop'),
  launchIsRunning: () => ipcRenderer.invoke('launch:isRunning'),

  // Logs
  logsGetAll:  () => ipcRenderer.invoke('logs:getAll'),
  logsOpenDir: () => ipcRenderer.invoke('logs:openDir'),

  // Version launcher
  appVersion: () => ipcRenderer.invoke('app:version'),

  // Mods optionnels
  modsGetOptional: () => ipcRenderer.invoke('mods:getOptional'),
  modsGetEnabled:  () => ipcRenderer.invoke('mods:getEnabled'),
  modsSetEnabled:  (paths: string[]) => ipcRenderer.invoke('mods:setEnabled', paths),

  // Listeners main → renderer (on/off correctement appairés pour éviter les fuites)
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    if (!_wrappers.has(cb)) {
      _wrappers.set(cb, (_e: unknown, ...args: unknown[]) => cb(...args))
    }
    ipcRenderer.on(channel, _wrappers.get(cb)!)
  },
  off: (channel: string, cb: (...args: unknown[]) => void) => {
    const wrapper = _wrappers.get(cb)
    if (wrapper) ipcRenderer.removeListener(channel, wrapper)
  },
})
