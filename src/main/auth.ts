import crypto from 'crypto'
import { net } from 'electron'
import { store, Account } from './store'

const API = 'https://earthkingdoms-mc.fr/api'

// Durées (secondes)
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

// ─── Helpers multicompte ────────────────────────────────────────────────────

/** Migre l'ancien format mono-compte vers le nouveau format multi-compte si nécessaire. */
function migrateIfNeeded(): void {
  const accounts   = (store.get('accounts')  as Account[])      ?? []
  const oldAccount =  store.get('account')   as Account | null
  if (accounts.length === 0 && oldAccount) {
    store.set('accounts',        [oldAccount])
    store.set('activeAccountId', oldAccount.uuid)
  }
}

/** Récupère le compte actif depuis la liste (synchrone, sans refresh). */
export function getActiveAccount(): Account | null {
  migrateIfNeeded()
  const accounts = (store.get('accounts')       as Account[]) ?? []
  const activeId =  store.get('activeAccountId') as string | null
  if (!activeId || accounts.length === 0) return null
  return accounts.find(a => a.uuid === activeId) ?? null
}

/** Met à jour un compte dans la liste (upsert par uuid). */
function upsertAccount(updated: Account): void {
  const accounts = [...((store.get('accounts') as Account[]) ?? [])]
  const idx = accounts.findIndex(a => a.uuid === updated.uuid)
  if (idx >= 0) accounts[idx] = updated
  else accounts.push(updated)
  store.set('accounts', accounts)
}

/** Retourne la liste des comptes pour affichage (sans tokens). */
export function getAccounts(): Array<{ username: string; uuid: string; isAdmin: boolean }> {
  migrateIfNeeded()
  const accounts = (store.get('accounts') as Account[]) ?? []
  return accounts.map(({ username, uuid, isAdmin }) => ({ username, uuid, isAdmin }))
}

/** Définit le compte actif par uuid. */
export function switchAccount(uuid: string): Account | null {
  const accounts = (store.get('accounts') as Account[]) ?? []
  if (accounts.find(a => a.uuid === uuid)) {
    store.set('activeAccountId', uuid)
    return accounts.find(a => a.uuid === uuid) ?? null
  }
  return null
}

/** Retire un compte de la liste. Retourne le nouveau compte actif (ou null). */
export function removeAccount(uuid: string): Account | null {
  const accounts = [...((store.get('accounts') as Account[]) ?? [])].filter(a => a.uuid !== uuid)
  store.set('accounts', accounts)
  const activeId = store.get('activeAccountId') as string | null
  if (activeId === uuid) {
    const next = accounts[0] ?? null
    store.set('activeAccountId', next?.uuid ?? null)
    store.set('account', next)
    return next
  }
  return getActiveAccount()
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

  upsertAccount(account)
  store.set('activeAccountId', account.uuid)
  store.set('account', account)  // compat legacy

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
    upsertAccount(updated)
    store.set('account', updated)
    return updated
  } catch {
    return null
  }
}

// ─── getAccount (appelé au démarrage) ───────────────────────────────────────

export async function getAccount(): Promise<Account | null> {
  migrateIfNeeded()
  const account = getActiveAccount()
  if (!account) return null

  const now = Math.floor(Date.now() / 1000)

  if (account.tokenExpires > now + REFRESH_THRESHOLD) return account

  if (account.tokenExpires > now - GRACE_PERIOD) {
    const refreshed = await refreshToken(account)
    if (refreshed) return refreshed
    if (account.tokenExpires > now) return account
  }

  // Token expiré → retirer ce compte
  removeAccount(account.uuid)
  store.set('account', null)
  return null
}

// ─── Logout ─────────────────────────────────────────────────────────────────

export function logout(uuid?: string): Account | null {
  const target = uuid ?? (getActiveAccount()?.uuid ?? null)
  if (!target) return null
  return removeAccount(target)
}
