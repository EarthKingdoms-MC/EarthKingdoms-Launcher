import { useState, useEffect } from 'react'

export interface Account {
  username:     string
  uuid:         string
  token:        string
  tokenExpires: number
  isAdmin:      boolean
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

export interface LaunchProfile {
  id:       string
  name:     string
  ram:      number
  resW:     number
  resH:     number
  javaPath: string | null
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

      serverStatus(): Promise<ServerStatus | { online: false }>

      newsLoad(): Promise<string | null>
      skinLoad(username: string): Promise<string | null>
      skinLoadUrl(url: string): Promise<string | null>
      skinUpload(data: number[]): Promise<{ ok: boolean; error?: string }>
      skinHistoryList(): Promise<{ ok: boolean; history?: SkinHistoryItem[]; error?: string }>
      skinHistoryRestore(id: string): Promise<{ ok: boolean; error?: string }>

      launchStart(): Promise<{ ok: boolean; error?: string }>
      launchStop(): void
      launchIsRunning(): Promise<boolean>

      logsGetAll(): Promise<string[]>
      logsOpenDir(): Promise<void>

      dialogOpenFile(): Promise<string | null>
      appVersion(): Promise<string>
      updateCheck(): Promise<{ available: boolean }>

      modsGetOptional(): Promise<Array<{ url: string; size: number; hash: string; path: string }>>
      modsGetEnabled(): Promise<string[]>
      modsSetEnabled(paths: string[]): Promise<void>

      systemTotalRam(): Promise<number>
      patchnotesLoad(): Promise<string | null>

      profilesList(): Promise<{ profiles: LaunchProfile[]; activeId: string }>
      profilesSave(profile: LaunchProfile): Promise<void>
      profilesDelete(id: string): Promise<void>
      profilesSetActive(id: string): Promise<void>

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
        // Skin indisponible — fallback icône générique affiché
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
