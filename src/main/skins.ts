/**
 * Gestion des skins côté launcher : validation, déduplication, application vérifiée.
 *
 * Sans import d'Electron (transport, hash et journal sont injectés) pour pouvoir
 * être testé. Les endpoints utilisés existent déjà côté Web :
 *   GET  /api/skin/history/list          historique (le plus récent = skin actuel)
 *   POST /api/skin/history/restore/:id   réactive une entrée de l'historique
 *   POST /api/skin/upload                envoie un nouveau skin (multipart)
 *
 * Source de vérité : le serveur. Le skin « actuel » est l'entrée la plus récente de
 * l'historique ; le jeu lit /skins/{pseudo}.png. Une opération n'est donc annoncée
 * comme réussie qu'après relecture du fichier actif (voir verifyApplied).
 */
import type { AuthedResult, HttpInit } from './authService'

export const SKIN_ORIGIN       = 'https://earthkingdoms-mc.fr'
export const SKIN_MAX_BYTES    = 100 * 1024   // limite serveur (api/skin/upload)
export const SKIN_SIZE         = 64           // 64×64 exigé par le serveur
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export interface HistoryItem {
  id:         string | number
  skin_url:   string
  created_at: string | null
  is_current: boolean
}

export type SkinValidation = { ok: true } | { ok: false; error: string }

/** Mêmes règles que le serveur : PNG, ≤ 100 Ko, 64×64. */
export function validateSkinPng(bytes: Uint8Array): SkinValidation {
  if (bytes.length === 0)            return { ok: false, error: 'Fichier vide.' }
  if (bytes.length > SKIN_MAX_BYTES) return { ok: false, error: `Fichier trop volumineux (${Math.ceil(bytes.length / 1024)} Ko) - max 100 Ko.` }
  if (bytes.length < 33 || !PNG_MAGIC.every((b, i) => bytes[i] === b))
    return { ok: false, error: 'Fichier invalide (PNG requis).' }
  // Le premier chunk d'un PNG valide est IHDR, aux octets 12..16.
  const ihdr = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
  if (ihdr !== 'IHDR') return { ok: false, error: 'Fichier PNG invalide.' }
  const view   = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width  = view.getUint32(16)
  const height = view.getUint32(20)
  if (width !== SKIN_SIZE || height !== SKIN_SIZE)
    return { ok: false, error: `Dimensions incorrectes (${width}×${height}) - le skin doit être ${SKIN_SIZE}×${SKIN_SIZE} px.` }
  return { ok: true }
}

/**
 * URL absolue d'un skin du serveur. Refuse tout autre hôte : le launcher n'a pas
 * à devenir un relais de requêtes vers des adresses arbitraires.
 */
export function resolveSkinUrl(url: string): string | null {
  try {
    const u = new URL(url, SKIN_ORIGIN)
    if (u.protocol !== 'https:') return null
    const host = u.hostname.toLowerCase()
    if (host !== 'earthkingdoms-mc.fr' && host !== 'www.earthkingdoms-mc.fr') return null
    return u.toString()
  } catch {
    return null
  }
}

/** Construit un corps multipart/form-data pour le champ « skin ». */
export function buildSkinMultipart(bytes: Uint8Array, filename: string, boundary: string): Uint8Array {
  const safeName = filename.replace(/[^A-Za-z0-9_.-]/g, '_') || 'skin.png'
  const head = new TextEncoder().encode(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="skin"; filename="${safeName}"\r\n` +
    `Content-Type: image/png\r\n\r\n`
  )
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`)
  const out = new Uint8Array(head.length + bytes.length + tail.length)
  out.set(head, 0)
  out.set(bytes, head.length)
  out.set(tail, head.length + bytes.length)
  return out
}

export type SkinResult =
  | { ok: true;  outcome: 'unchanged' | 'restored' | 'uploaded'; verified: boolean | null }
  | { ok: false; error: string }

export interface SkinDeps {
  username:    string
  /** Appel authentifié pour le compte propriétaire de l'opération. */
  authed:      (path: string, init?: HttpInit) => Promise<AuthedResult>
  /** Téléchargement public ; null en cas d'échec réseau. */
  fetchBytes:  (url: string) => Promise<{ status: number; bytes: Uint8Array } | null>
  sha256:      (bytes: Uint8Array) => string
  newBoundary: () => string
  log?:        (message: string) => void
}

function sessionError(r: AuthedResult): string | null {
  switch (r.kind) {
    case 'no-session':      return 'Non connecté ! Reconnecte-toi dans le launcher.'
    case 'session-expired': return 'Session expirée ! Reconnecte-toi dans le launcher.'
    case 'unavailable':     return 'Serveur injoignable ! Vérifie ta connexion.'
    default:                return null
  }
}

async function errorOf(res: { status: number; json(): Promise<unknown> }): Promise<string> {
  let msg = `Erreur serveur (${res.status})`
  try {
    const data = await res.json()
    if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
      msg = (data as { error: string }).error
    }
  } catch { /* corps non JSON */ }
  return msg
}

/**
 * Un service par compte et par opération. Les entrées de l'historique sont
 * immuables côté serveur : leur empreinte est mise en cache (clé = id) pour que
 * la détection de doublon ne retélécharge pas dix images à chaque action.
 */
export function createSkinService(deps: SkinDeps, hashCache = new Map<string, string>()) {
  const log = deps.log ?? (() => {})

  async function listHistory(): Promise<{ ok: true; history: HistoryItem[] } | { ok: false; error: string }> {
    const r = await deps.authed('/skin/history/list')
    const err = sessionError(r)
    if (err) return { ok: false, error: err }
    if (r.kind !== 'response') return { ok: false, error: 'Erreur réseau.' }
    if (r.res.status < 200 || r.res.status >= 300) return { ok: false, error: await errorOf(r.res) }
    try {
      const data = await r.res.json() as { history?: HistoryItem[] }
      if (!Array.isArray(data.history)) return { ok: false, error: 'Réponse invalide du serveur.' }
      return { ok: true, history: data.history }
    } catch {
      return { ok: false, error: 'Réponse invalide du serveur.' }
    }
  }

  async function bytesOf(item: HistoryItem): Promise<Uint8Array | null> {
    const url = resolveSkinUrl(item.skin_url)
    if (!url) return null
    const got = await deps.fetchBytes(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`)
    return got && got.status === 200 ? got.bytes : null
  }

  async function hashOf(item: HistoryItem): Promise<string | null> {
    const key = String(item.id)
    const cached = hashCache.get(key)
    if (cached) return cached
    const bytes = await bytesOf(item)
    if (!bytes) return null
    const h = deps.sha256(bytes)
    hashCache.set(key, h)
    return h
  }

  /** Entrée de l'historique dont le contenu est identique à `hash`, si elle existe. */
  async function findByHash(history: HistoryItem[], hash: string): Promise<HistoryItem | null> {
    // Le skin actuel d'abord : c'est le cas du « même fichier réimporté ».
    const ordered = [...history].sort((a, b) => Number(b.is_current) - Number(a.is_current))
    for (const item of ordered) {
      if (await hashOf(item) === hash) return item
    }
    return null
  }

  /** Relit le skin actif servi au jeu et le compare au contenu attendu. */
  async function verifyApplied(expectedHash: string): Promise<boolean | null> {
    const url = `${SKIN_ORIGIN}/skins/${encodeURIComponent(deps.username.toLowerCase())}.png?t=${Date.now()}`
    const got = await deps.fetchBytes(url)
    if (!got || got.status !== 200) return null          // vérification impossible, pas un échec
    return deps.sha256(got.bytes) === expectedHash
  }

  async function postUpload(bytes: Uint8Array): Promise<{ ok: true } | { ok: false; error: string }> {
    const boundary = deps.newBoundary()
    const r = await deps.authed('/skin/upload', {
      method:  'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body:    buildSkinMultipart(bytes, `${deps.username.toLowerCase()}.png`, boundary),
    })
    const err = sessionError(r)
    if (err) return { ok: false, error: err }
    if (r.kind !== 'response') return { ok: false, error: 'Erreur réseau.' }
    if (r.res.status >= 200 && r.res.status < 300) return { ok: true }
    return { ok: false, error: await errorOf(r.res) }
  }

  async function finish(outcome: 'restored' | 'uploaded', expectedHash: string): Promise<SkinResult> {
    const verified = await verifyApplied(expectedHash)
    if (verified === false) {
      log(`Skin: ${outcome} accepté par le serveur mais le skin actif ne correspond pas`)
      return { ok: false, error: 'Le serveur a accepté la demande mais le skin appliqué ne correspond pas. Réessaie dans un instant.' }
    }
    return { ok: true, outcome, verified }
  }

  /**
   * Réactive une entrée de l'historique.
   * Chemin nominal : POST /history/restore/:id.
   * Repli : si la route refuse le token launcher (401 persistant malgré un token
   * fraîchement renouvelé - cas d'un serveur dont la route de restauration
   * n'accepte que la session web), on renvoie le même fichier via /upload, qui
   * accepte le token launcher. Le skin est appliqué ; seul l'historique peut alors
   * compter une entrée de plus tant que le serveur n'est pas corrigé.
   */
  async function restore(id: string): Promise<SkinResult> {
    const listed = await listHistory()
    if (!listed.ok) return listed
    const item = listed.history.find(h => String(h.id) === String(id))
    if (!item) return { ok: false, error: 'Skin introuvable dans ton historique.' }
    if (item.is_current) return { ok: true, outcome: 'unchanged', verified: null }

    const hash = await hashOf(item)

    const r = await deps.authed(`/skin/history/restore/${encodeURIComponent(String(id))}`, { method: 'POST' })
    const err = sessionError(r)
    if (err) return { ok: false, error: err }
    if (r.kind !== 'response') return { ok: false, error: 'Erreur réseau.' }

    if (r.res.status >= 200 && r.res.status < 300) {
      if (!hash) return { ok: true, outcome: 'restored', verified: null }
      return finish('restored', hash)
    }

    if (r.res.status === 401) {
      log('Skin: restore refusé (401) malgré un token valide - repli par re-envoi du fichier')
      const bytes = await bytesOf(item)
      if (!bytes) return { ok: false, error: 'Impossible de récupérer ce skin sur le serveur.' }
      const valid = validateSkinPng(bytes)
      if (!valid.ok) return { ok: false, error: valid.error }
      const up = await postUpload(bytes)
      if (!up.ok) return up
      return finish('restored', deps.sha256(bytes))
    }

    return { ok: false, error: await errorOf(r.res) }
  }

  /** Envoie un skin, sauf s'il existe déjà dans l'historique (alors on le sélectionne). */
  async function upload(bytes: Uint8Array): Promise<SkinResult> {
    const valid = validateSkinPng(bytes)
    if (!valid.ok) return valid

    const hash   = deps.sha256(bytes)
    const listed = await listHistory()
    if (!listed.ok) return listed

    const existing = await findByHash(listed.history, hash)
    if (existing) {
      if (existing.is_current) {
        log('Skin: fichier identique au skin actuel - rien à envoyer')
        return { ok: true, outcome: 'unchanged', verified: null }
      }
      log('Skin: fichier déjà présent dans l\'historique - sélection de l\'entrée existante')
      return restore(String(existing.id))
    }

    const up = await postUpload(bytes)
    if (!up.ok) return up
    return finish('uploaded', hash)
  }

  return { listHistory, restore, upload }
}

export type SkinService = ReturnType<typeof createSkinService>

/**
 * Sérialise les opérations d'écriture : un double clic, une nouvelle tentative
 * ou une réponse répétée ne peuvent plus produire deux envois en parallèle.
 */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return function run<T>(task: () => Promise<T>): Promise<T> {
    const next = tail.then(task, task)
    tail = next.catch(() => undefined)
    return next
  }
}
