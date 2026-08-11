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
  authLogin:         (username: string, password: string) => ipcRenderer.invoke('auth:login', username, password),
  authGetAccount:    ()                                   => ipcRenderer.invoke('auth:getAccount'),
  authLogout:        ()                                   => ipcRenderer.invoke('auth:logout'),
  authGetAccounts:   ()                                   => ipcRenderer.invoke('auth:getAccounts'),
  authSwitchAccount: (uuid: string)                       => ipcRenderer.invoke('auth:switchAccount', uuid),
  authRemoveAccount: (uuid: string)                       => ipcRenderer.invoke('auth:removeAccount', uuid),

  // Statut serveur
  serverStatus: () => ipcRenderer.invoke('server:status'),

  // Statut joueur
  statusPlayer: () => ipcRenderer.invoke('status:player'),

  // Actualités
  newsLoad: () => ipcRenderer.invoke('news:load'),

  // Skin
  skinLoad:           (username: string) => ipcRenderer.invoke('skin:load', username),
  skinLoadUrl:        (url: string)      => ipcRenderer.invoke('skin:loadUrl', url),
  skinUpload:         (data: number[])   => ipcRenderer.invoke('skin:upload', data),
  skinHistoryList:    ()                 => ipcRenderer.invoke('skin:historyList'),
  skinHistoryRestore: (id: string)       => ipcRenderer.invoke('skin:historyRestore', id),

  // Lancement Minecraft
  launchStart:     (dev?: boolean) => ipcRenderer.invoke('launch:start', dev),
  launchStop:      () => ipcRenderer.send('launch:stop'),
  launchIsRunning: () => ipcRenderer.invoke('launch:isRunning'),

  // Logs
  logsGetAll:  () => ipcRenderer.invoke('logs:getAll'),
  logsOpenDir: () => ipcRenderer.invoke('logs:openDir'),

  // Sélecteur fichier
  dialogOpenFile: () => ipcRenderer.invoke('dialog:openFile'),

  // Version launcher
  appVersion: () => ipcRenderer.invoke('app:version'),

  // Auto-update
  updateCheck: () => ipcRenderer.invoke('update:check'),

  // Mods optionnels
  modsGetOptional: () => ipcRenderer.invoke('mods:getOptional'),
  modsGetEnabled:  () => ipcRenderer.invoke('mods:getEnabled'),
  modsSetEnabled:  (paths: string[]) => ipcRenderer.invoke('mods:setEnabled', paths),

  // RAM système
  systemTotalRam: () => ipcRenderer.invoke('system:totalRam'),

  // Démarrage automatique
  systemGetStartupEnabled: () => ipcRenderer.invoke('system:getStartupEnabled'),
  systemSetStartupEnabled: (enabled: boolean) => ipcRenderer.invoke('system:setStartupEnabled', enabled),

  // Réparation (retéléchargement des mods)
  repairMods: () => ipcRenderer.invoke('repair:mods'),

  // Patch notes
  patchnotesLoad: () => ipcRenderer.invoke('patchnotes:load'),

  // Rapport de bug
  bugCaptureScreen: () => ipcRenderer.invoke('bug:captureScreen'),

  // Profils de lancement
  profilesList:      ()                                => ipcRenderer.invoke('profiles:list'),
  profilesUpdate:    (patch: unknown)                  => ipcRenderer.invoke('profiles:update', patch),
  profilesCreate:    (name: string, sourceId: string)  => ipcRenderer.invoke('profiles:create', name, sourceId),
  profilesRename:    (id: string, name: string)        => ipcRenderer.invoke('profiles:rename', id, name),
  profilesDelete:    (id: string)                      => ipcRenderer.invoke('profiles:delete', id),
  profilesReset:     (id: string, what: string)        => ipcRenderer.invoke('profiles:reset', id, what),
  profilesSetActive: (id: string)                      => ipcRenderer.invoke('profiles:setActive', id),

  // Paliers de performance
  perfHardware:          ()                                => ipcRenderer.invoke('perf:hardware'),
  perfNeedsSetup:        ()                                => ipcRenderer.invoke('perf:needsSetup'),
  perfChooseLevel:       (level: string)                   => ipcRenderer.invoke('perf:chooseLevel', level),
  perfDismissSetup:      ()                                => ipcRenderer.invoke('perf:dismissSetup'),
  perfLevels:            ()                                => ipcRenderer.invoke('perf:levels'),
  perfModTiers:          ()                                => ipcRenderer.invoke('perf:modTiers'),
  perfActiveGameOptions: ()                                => ipcRenderer.invoke('perf:activeGameOptions'),
  perfSetGameOptions:    (values: Record<string, string>)  => ipcRenderer.invoke('perf:setGameOptions', values),
  perfApplyGameOptions:  ()                                => ipcRenderer.invoke('perf:applyGameOptions'),

  // Garde-fou de fermeture (modifications non sauvegardées)
  unsavedGuard:  (on: boolean)      => ipcRenderer.send('app:unsaved-guard', on),
  closeResponse: (doClose: boolean) => ipcRenderer.send('app:close-response', doClose),

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
