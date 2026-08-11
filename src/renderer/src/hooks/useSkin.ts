import { useState, useEffect } from 'react'

export interface Account {
  username:            string
  uuid:                string
  token:               string
  tokenExpires:        number
  isAdmin:             boolean
  canAccessDevServer:  boolean
}

export interface ServerStatus {
  online:     boolean
  players:    number
  maxPlayers: number
  ping:       number
  version:    string
}

export type AuthLoginResult =
  | { ok: true;  account: Account }
  | { ok: false; code: number; message: string }

export interface LaunchProgressEvent {
  event:  'progress' | 'check' | 'extract' | 'patch' | 'speed'
  type?:  string
  task?:  number
  total?: number
  speed?: number
}

export interface SkinHistoryItem {
  id:         string | number
  skin_url:   string
  created_at: string | null
  is_current: boolean
}

export type PerfLevel = 'low' | 'medium' | 'high'

export interface LaunchProfile {
  id:        string
  name:      string
  ram:       number
  resW:      number
  resH:      number
  javaPath:  string | null
  perfLevel: PerfLevel
  builtin:   boolean
  /** null = la sélection de mods suit le palier ; tableau = sélection figée. */
  mods:      string[] | null
  /** Réglages graphiques modifiés à la main, par-dessus ceux du palier. */
  gameOptions: Record<string, string> | null
}

export interface HardwareInfo {
  cpuCores:    number
  cpuModel:    string
  totalRamGB:  number
  gpuName:     string | null
  gpuKind:     'dedicated' | 'integrated' | 'unknown'
  score:       number
  recommended: PerfLevel
}

export interface PerfLevelInfo {
  level:       PerfLevel
  label:       string
  desc:        string
  ram:         number
  gameOptions: Record<string, string>
}

export interface ActiveGameOptions {
  /** Valeurs effectives : palier + modifications manuelles. */
  values:     Record<string, string>
  /** Valeurs du palier seul - sert à repérer ce qui a été modifié. */
  defaults:   Record<string, string>
  /** Clés que l'interface a le droit de proposer. */
  editable:   string[]
  overridden: string[]
}

/** Retour commun des écritures qui peuvent dériver un profil personnalisé. */
export interface ProfileWriteResult {
  profileId:   string
  profileName: string
  created:     boolean
}

export interface GameJob {
  name:  string | Record<string, unknown>
  level: number
}

export interface GamePlayer {
  uuid:       string
  name:       string
  // null quand le serveur de jeu est injoignable (voir dataAvailable côté
  // statusPlayer) - affiché "N/A" plutôt que de bloquer l'écran sur une erreur.
  online:     boolean | null
  balance:    number | null
  nation:     string | null
  nationName: string | null
  nationRank: string | null
  jobs:       GameJob[] | null
  kills:      number | null
  deaths:     number | null
  kda:        number | null
  playtime:   string | null
}

declare global {
  interface Window {
    api: {
      minimize(): void
      maximize(): void
      close(): void
      openExternal(url: string): void

      storeGet(key: string): Promise<unknown>
      storeSet(key: string, value: unknown): Promise<void>

      authLogin(username: string, password: string): Promise<AuthLoginResult>
      authGetAccount(): Promise<Account | null>
      authLogout(): Promise<void>
      authGetAccounts(): Promise<Array<{ username: string; uuid: string; isAdmin: boolean }>>
      authSwitchAccount(uuid: string): Promise<{ ok: boolean; account?: Account }>
      authRemoveAccount(uuid: string): Promise<{ ok: boolean; nextAccount?: Account | null }>

      bugCaptureScreen(): Promise<string | null>

      serverStatus(): Promise<ServerStatus | { online: false }>

      statusPlayer(): Promise<{ ok: boolean; player?: GamePlayer; dataAvailable?: boolean; error?: string }>

      newsLoad(): Promise<string | null>
      skinLoad(username: string): Promise<string | null>
      skinLoadUrl(url: string): Promise<string | null>
      skinUpload(data: number[]): Promise<{ ok: boolean; error?: string }>
      skinHistoryList(): Promise<{ ok: boolean; history?: SkinHistoryItem[]; error?: string }>
      skinHistoryRestore(id: string): Promise<{ ok: boolean; error?: string }>

      launchStart(dev?: boolean): Promise<{ ok: boolean; error?: string }>
      launchStop(): void
      launchIsRunning(): Promise<boolean>

      logsGetAll(): Promise<string[]>
      logsOpenDir(): Promise<void>

      dialogOpenFile(): Promise<string | null>
      appVersion(): Promise<string>
      updateCheck(): Promise<{ available: boolean; macUpdate?: boolean; latestVersion?: string; downloadUrl?: string }>

      modsGetOptional(): Promise<Array<{ url: string; size: number; hash: string; path: string }>>
      modsGetEnabled(): Promise<string[]>
      modsSetEnabled(paths: string[]): Promise<ProfileWriteResult>

      systemTotalRam(): Promise<number>

      systemGetStartupEnabled(): Promise<boolean>
      systemSetStartupEnabled(enabled: boolean): Promise<void>

      repairMods(): Promise<{ ok: boolean; error?: string; cancelled?: boolean }>
      patchnotesLoad(): Promise<string | null>

      profilesList(): Promise<{ profiles: LaunchProfile[]; activeId: string; modCounts: Record<string, number> }>
      profilesUpdate(patch: Partial<LaunchProfile>): Promise<{ profile: LaunchProfile; created: boolean }>
      profilesCreate(name: string, sourceId: string): Promise<LaunchProfile>
      profilesRename(id: string, name: string): Promise<void>
      profilesDelete(id: string): Promise<void>
      profilesReset(id: string, what: 'mods' | 'gameOptions' | 'all'): Promise<void>
      profilesSetActive(id: string): Promise<LaunchProfile>

      perfHardware(): Promise<HardwareInfo>
      perfNeedsSetup(): Promise<boolean>
      perfChooseLevel(level: PerfLevel): Promise<{ ok: boolean; profile?: LaunchProfile }>
      perfDismissSetup(): Promise<void>
      perfLevels(): Promise<PerfLevelInfo[]>
      perfModTiers(): Promise<Record<string, PerfLevel>>
      perfActiveGameOptions(): Promise<ActiveGameOptions>
      perfSetGameOptions(values: Record<string, string>): Promise<ProfileWriteResult>
      perfApplyGameOptions(): Promise<{ ok: boolean; applied?: number; cancelled?: boolean; error?: string }>

      unsavedGuard(on: boolean): void
      closeResponse(doClose: boolean): void

      on(channel: string, cb: (...args: unknown[]) => void): void
      off(channel: string, cb: (...args: unknown[]) => void): void
    }
  }
}

/** Extrait la tête (face + hat overlay) depuis la texture skin.
 *  Le chargement passe par le main process (net.fetch) pour contourner CSP/CORS.
 *  La data URL renvoyée est dessinée sur canvas sans problème de taint.
 *  refreshKey : incrémente pour forcer un rechargement après upload. */
export function useSkinHead(username: string, refreshKey?: number): string | null {
  const [headUrl, setHeadUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!username) return
    let cancelled = false
    setHeadUrl(null)

    async function load() {
      try {
        const dataUrl = await window.api.skinLoad(username)
        if (!dataUrl || cancelled) return

        const img = new Image()
        img.onload = () => {
          if (cancelled) return
          const cvs = document.createElement('canvas')
          cvs.width = 8
          cvs.height = 8
          const ctx = cvs.getContext('2d')!
          ctx.imageSmoothingEnabled = false
          ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8)   // face (base layer)
          ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8)  // hat  (overlay layer)
          setHeadUrl(cvs.toDataURL())
        }
        img.src = dataUrl
      } catch {
        // Skin indisponible - fallback icône générique affiché
      }
    }

    load()
    return () => { cancelled = true }
  }, [username, refreshKey])

  return headUrl
}

/** Retourne la data URL brute de la texture complète (pour affichage dans SkinModal).
 *  refreshKey : incrémente pour forcer un rechargement après upload. */
export function useSkinTexture(username: string, refreshKey?: number): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!username) return
    let cancelled = false
    setDataUrl(null)
    window.api.skinLoad(username).then(url => {
      if (!cancelled) setDataUrl(url)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [username, refreshKey])

  return dataUrl
}

export const getSkinUrl = (username: string) =>
  `https://earthkingdoms-mc.fr/skins/${username}.png`
