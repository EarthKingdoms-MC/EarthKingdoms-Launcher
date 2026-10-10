import crypto from 'crypto'
import fs from 'fs'
import { request as httpsRequest } from 'https'
import { app, net, BrowserWindow } from 'electron'
import { store, getStoredAccounts, setStoredAccounts, getStoredAccount, setStoredAccount } from './store'
import {
  createAuthService, toPublicAccount,
  type Account, type AuthEvent, type HttpInit, type HttpResponse, type PublicAccount,
} from './authService'

const ORIGIN = 'https://earthkingdoms-mc.fr'
const API = `${ORIGIN}/api`
const REQUEST_TIMEOUT_MS = 30_000

/**
 * Chemin relatif à l'API (« /auth/... ») ou URL absolue sur l'origine EarthKingdoms
 * (utile pour /launcher/files, hors de /api). Tout autre hôte est refusé : le
 * Bearer du launcher ne doit jamais partir ailleurs.
 */
function resolveUrl(path: string): string {
  if (path.startsWith('/') && !path.startsWith('//')) return `${API}${path}`
  if (path.startsWith(`${ORIGIN}/`)) return path
  throw new Error('URL non autorisée')
}

export const getLauncherUA = (): string => `EarthKingdomsLauncher/${app.getVersion()}`

/** UUID déterministe identique à l'ancien launcher (OfflinePlayer MD5 v3) */
function makeUUID(username: string): string {
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${username}`).digest('hex')
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '3' + hash.slice(13, 16),
    ((parseInt(hash.slice(16, 18), 16) & 0x3f | 0x80)).toString(16).padStart(2, '0') + hash.slice(18, 20),
    hash.slice(20, 32),
  ].join('-')
}

// ─── Transport HTTP ─────────────────────────────────────────────────────────

/** Corps binaire (multipart) : https natif, net.fetch gérant mal Buffer + en-têtes custom. */
function binaryRequest(path: string, init: HttpInit): Promise<HttpResponse> {
  const body = Buffer.from(init.body as Uint8Array)
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      resolveUrl(path),
      {
        method:  init.method ?? 'POST',
        headers: { ...init.headers, 'User-Agent': getLauncherUA(), 'Content-Length': String(body.length) },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          resolve({ status: res.statusCode ?? 0, json: async () => JSON.parse(text) })
        })
        res.on('error', reject)
      }
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function transport(path: string, init: HttpInit = {}): Promise<HttpResponse> {
  if (init.body instanceof Uint8Array) return binaryRequest(path, init)

  const headers = new Headers(init.headers)
  headers.set('User-Agent', getLauncherUA())
  const res = await net.fetch(resolveUrl(path), {
    method:  init.method,
    headers,
    body:    init.body as string | undefined,
    signal:  AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  return { status: res.status, json: () => res.json() }
}

// ─── Service (câblage réel) ─────────────────────────────────────────────────

let logSink: (message: string) => void = () => {}
/** Branche le journal du launcher (jamais de token dans les messages). */
export function setAuthLogger(fn: (message: string) => void): void { logSink = fn }

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function handleEvent(event: AuthEvent): void {
  if (event.type === 'session-expired') {
    // Le compte vient d'être retiré côté main : l'interface doit se resynchroniser,
    // sans quoi elle garderait un état « connecté » contradictoire.
    broadcast('auth:session-expired', { uuid: event.uuid, username: event.username })
  }
}

/**
 * Une seule fois, après `app.whenReady()` (safeStorage n'est pas disponible avant) :
 * rapatrie l'ancien compte mono-compte vers la liste, puis EFFACE la copie legacy.
 * Garder deux copies du token faisait diverger l'état d'authentification et
 * pouvait ressusciter un compte déconnecté.
 */
let migrated = false
function migrateLegacyAccount(): void {
  if (migrated) return
  migrated = true
  const legacy = getStoredAccount()
  if (!legacy) return
  if (getStoredAccounts().length === 0) {
    setStoredAccounts([legacy])
    store.set('activeAccountId', legacy.uuid)
  }
  setStoredAccount(null)
}

let service: ReturnType<typeof createAuthService> | null = null
function svc() {
  if (service) return service
  migrateLegacyAccount()
  service = createAuthService({
    getAccounts: () => getStoredAccounts(),
    setAccounts: (accounts) => setStoredAccounts(accounts),
    getActiveId: () => (store.get('activeAccountId') as string | null) ?? null,
    setActiveId: (uuid) => { store.set('activeAccountId', uuid) },
    transport,
    now:         () => Math.floor(Date.now() / 1000),
    makeUuid:    makeUUID,
    onEvent:     handleEvent,
    log:         (m) => logSink(m),
  })
  return service
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

// ─── API du module ──────────────────────────────────────────────────────────

/** Compte actif tel qu'enregistré (synchrone, sans appel réseau). Réservé au main. */
export function getActiveAccount(): Account | null { return svc().getActive() }

/** Vue sans token pour le renderer. */
export function toPublic(account: Account | null): PublicAccount | null {
  return account ? toPublicAccount(account, nowSeconds()) : null
}

export const login          = (username: string, password: string) => svc().login(username, password)
export const getAccount     = () => svc().getAccount()
export const getAccounts    = () => svc().listPublic()
export const getAccountByUuid = (uuid: string): Account | null => svc().findAccount(uuid)
export const switchAccount  = (uuid: string) => svc().switchTo(uuid)

/**
 * Retire un compte (ou le compte actif) et ses credentials locaux.
 * Ne touche JAMAIS au processus de jeu : le jeu n'a pas besoin de la session web
 * (il utilise son propre jeton de lancement à usage unique) et continue de tourner.
 */
export function removeAccount(uuid: string): Account | null { return svc().remove(uuid, 'remove') }
export function logout(uuid?: string): Account | null {
  const target = uuid ?? svc().getActive()?.uuid ?? null
  return target ? svc().remove(target, 'logout') : null
}

/** Requête authentifiée pour un compte donné (par défaut : le compte actif). */
export const authedRequest = (path: string, init?: HttpInit, uuid?: string) =>
  svc().authedRequest(path, init, uuid)

// ─── Game Auth Token ────────────────────────────────────────────────────────
// Jeton à usage unique (12 h côté Web, voir game-token/route.ts) prouvant que le Web a autorisé ce lancement pour
// cet utilisateur, vérifié localement par Core (mod) sans rappel au Web à
// chaque connexion. Généré juste avant chaque lancement du jeu (pas au login).
// Distinct du token de session du launcher : c'est le SEUL credential que le jeu
// reçoit, et il n'est jamais renouvelé ni révoqué par la session du launcher.

export async function getGameAuthToken(uuid: string): Promise<{ token: string; expiresAt: number }> {
  const r = await svc().authedRequest('/auth/launcher/game-token', { method: 'POST' }, uuid)

  if (r.kind === 'no-session')      throw new Error('Non connecté ! Reconnecte-toi dans le launcher.')
  if (r.kind === 'session-expired') throw new Error('Session expirée ! Reconnecte-toi avant de relancer le jeu.')
  if (r.kind === 'unavailable')     throw new Error('Impossible de contacter le serveur pour autoriser le lancement ! Vérifie ta connexion.')

  const { res } = r
  if (res.status < 200 || res.status >= 300) {
    const messages: Record<number, string> = {
      401: 'Session expirée ! Reconnecte-toi avant de relancer le jeu.',
      409: 'Une autorisation de lancement est déjà en cours pour ce compte ! Réessaie dans quelques secondes.',
      429: 'Trop de tentatives de lancement ! Réessaie dans quelques minutes.',
      500: 'Erreur interne du serveur (500) lors de l’autorisation du lancement.',
      502: 'Le serveur est inaccessible (502) lors de l’autorisation du lancement.',
      503: 'Le service est temporairement indisponible (503) lors de l’autorisation du lancement.',
      504: 'Le serveur a mis trop de temps à répondre (504) lors de l’autorisation du lancement.',
    }
    throw new Error(messages[res.status] ?? `Erreur ${res.status} lors de l'autorisation du lancement.`)
  }

  const data = await res.json().catch(() => null) as { token?: unknown; expiresAt?: unknown } | null
  if (!data || typeof data.token !== 'string' || !data.token) {
    throw new Error('Réponse invalide du serveur (token de lancement manquant).')
  }
  return { token: data.token, expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : 0 }
}

/**
 * Debug : réinitialise le token du compte actif.
 *  - supprime d'éventuels anciens fichiers .ek_auth (versions précédentes du launcher) ;
 *  - tente un refresh forcé. Seul un refus définitif du serveur déconnecte ;
 *    une erreur réseau est rapportée sans toucher à la session.
 */
export async function resetActiveToken(
  authFiles: string[]
): Promise<{ ok: boolean; status?: 'refreshed' | 'logged_out' | 'no_account'; error?: string }> {
  for (const f of authFiles) {
    try { fs.rmSync(f, { force: true }) } catch { /* ignore */ }
  }
  const account = svc().getActive()
  if (!account) return { ok: true, status: 'no_account' }

  const outcome = await svc().refresh(account.uuid)
  if (outcome.kind === 'ok')        return { ok: true, status: 'refreshed' }
  if (outcome.kind === 'transient') return { ok: false, error: 'Serveur injoignable. Ta session est conservée, réessaie plus tard.' }
  if (outcome.kind === 'gone')      return { ok: true, status: 'no_account' }

  svc().remove(account.uuid, 'expired')
  return { ok: true, status: 'logged_out' }
}

/** Supprime les fichiers .ek_auth laissés par d'anciennes versions (token en clair). */
export function purgeLegacyAuthFiles(paths: string[]): void {
  for (const f of paths) {
    try { fs.rmSync(f, { force: true }) } catch { /* ignore */ }
  }
}
