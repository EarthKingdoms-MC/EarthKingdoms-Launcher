import crypto from 'crypto'
import { net } from 'electron'
import { store, Account } from './store'

const API = 'https://earthkingdoms-mc.fr/api'

// Durées (secondes) — identiques à l'ancien launcher
const REFRESH_THRESHOLD = 3600  // refresh préventif si < 1h restante
const GRACE_PERIOD      = 1800  // on tente encore un refresh 30 min après expiration

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

async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  return net.fetch(`${API}${path}`, options as Parameters<typeof net.fetch>[1])
}

// ─── Login ─────────────────────────────────────────────────────────────────

export async function login(
  username: string,
  password: string
): Promise<{ ok: true; account: Account } | { ok: false; code: number; message: string }> {
  let res: Response
  try {
    res = await apiFetch('/auth/launcher/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    })
  } catch {
    return { ok: false, code: 0, message: 'Impossible de contacter le serveur. Vérifie ta connexion.' }
  }

  if (!res.ok) {
    const messages: Record<number, string> = {
      401: 'Identifiants incorrects.',
      403: 'Compte désactivé ou email non vérifié.',
      429: 'Trop de tentatives. Réessaie dans quelques minutes.',
      500: 'Erreur serveur (500). Réessaie plus tard.',
      502: 'Serveur inaccessible (502).',
      503: 'Service indisponible (503).',
      504: 'Timeout serveur (504).',
    }
    return { ok: false, code: res.status, message: messages[res.status] ?? `Erreur ${res.status}.` }
  }

  const data = await res.json() as { token: string; expires: number; username: string; is_admin: boolean }
  const account: Account = {
    username:     data.username,
    uuid:         makeUUID(data.username),
    token:        data.token,
    tokenExpires: data.expires,
    isAdmin:      data.is_admin,
  }
  store.set('account', account)
  return { ok: true, account }
}

// ─── Refresh ────────────────────────────────────────────────────────────────

async function refreshToken(account: Account): Promise<Account | null> {
  try {
    const res = await apiFetch('/auth/launcher/refresh-token', {
      method:  'POST',
      headers: { Authorization: `Bearer ${account.token}` },
    })
    if (!res.ok) return null
    const data = await res.json() as { success: boolean; token: string; expires: number }
    if (!data.success) return null
    const updated: Account = { ...account, token: data.token, tokenExpires: data.expires }
    store.set('account', updated)
    return updated
  } catch {
    return null
  }
}

// ─── getAccount (appelé au démarrage) ───────────────────────────────────────

export async function getAccount(): Promise<Account | null> {
  const account = store.get('account')
  if (!account) return null

  const now = Math.floor(Date.now() / 1000)

  // Token encore valide et pas proche d'expirer → OK
  if (account.tokenExpires > now + REFRESH_THRESHOLD) return account

  // Token expire bientôt ou dans la grace period → tenter refresh
  if (account.tokenExpires > now - GRACE_PERIOD) {
    const refreshed = await refreshToken(account)
    if (refreshed) return refreshed
    // Refresh échoué mais toujours dans la période valide → on laisse passer
    if (account.tokenExpires > now) return account
  }

  // Token expiré et hors grace period → déconnecter
  store.set('account', null)
  return null
}

// ─── Logout ─────────────────────────────────────────────────────────────────

export function logout(): void {
  store.set('account', null)
}
