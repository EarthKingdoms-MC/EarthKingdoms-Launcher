/**
 * Cœur de l'authentification du launcher.
 *
 * Ce module n'importe volontairement ni Electron, ni electron-store, ni rien qui
 * touche au jeu : le stockage, le transport HTTP et l'horloge sont injectés
 * (voir auth.ts pour le câblage réel). Cela permet de tester tout le cycle de vie
 * des sessions - login, refresh, expiration, logout, changement de compte - sans
 * lancer Electron, et garantit par construction qu'une opération d'authentification
 * ne peut pas agir sur le processus de jeu.
 *
 * Contrat côté serveur (EarthKingdoms-Web, src/app/api/auth/launcher) :
 *  - le token launcher vit 7 jours ;
 *  - /refresh-token SUPPRIME l'ancien token et en crée un nouveau (rotation à usage
 *    unique) : deux refresh concurrents avec le même token se solderaient par un
 *    401 pour le second. D'où le « single-flight » ci-dessous ;
 *  - 401 = token inconnu/expiré (définitif) ; réseau, 429 et 5xx = transitoires.
 */

export interface Account {
  username:           string
  uuid:               string
  token:              string
  tokenExpires:       number  // timestamp Unix en secondes
  isAdmin:            boolean
  // Indicatif UI (affichage du bouton DEV) - jamais une source d'autorité :
  // le serveur revérifie le token à chaque téléchargement de fichiers dev.
  canAccessDevServer: boolean
}

/** Vue d'un compte exposée au renderer : jamais le token. */
export interface PublicAccount {
  username:           string
  uuid:               string
  isAdmin:            boolean
  canAccessDevServer: boolean
  /** true si le token est expiré localement et n'a pas pu être renouvelé (hors ligne). */
  stale:              boolean
}

export interface HttpResponse {
  status: number
  json(): Promise<unknown>
}

export interface HttpInit {
  method?:  string
  headers?: Record<string, string>
  body?:    string | Uint8Array
}

/** Lève en cas d'échec réseau ; ne lève jamais pour un statut HTTP. */
export type Transport = (path: string, init?: HttpInit) => Promise<HttpResponse>

export interface AuthDeps {
  getAccounts:   () => Account[]
  setAccounts:   (accounts: Account[]) => void
  getActiveId:   () => string | null
  setActiveId:   (uuid: string | null) => void
  transport:     Transport
  /** Secondes depuis l'epoch. */
  now:           () => number
  onEvent?:      (event: AuthEvent) => void
  log?:          (message: string) => void
  /** Dérive l'UUID d'un compte depuis son pseudo (UUID hors-ligne historique). */
  makeUuid:      (username: string) => string
}

export type AuthEvent =
  | { type: 'session-expired'; uuid: string; username: string }
  | { type: 'accounts-changed'; reason: 'login' | 'logout' | 'switch' | 'remove' | 'expired' | 'refresh' }

export type LoginResult =
  | { ok: true;  account: Account }
  | { ok: false; code: number; message: string }

export type RefreshOutcome =
  | { kind: 'ok';        account: Account }
  | { kind: 'invalid' }                       // le serveur refuse définitivement ce token
  | { kind: 'transient'; reason: string }     // réseau / 429 / 5xx : on ne déconnecte pas
  | { kind: 'gone' }                          // le compte a été retiré pendant l'appel

export type AuthedResult =
  | { kind: 'response';        res: HttpResponse }
  | { kind: 'no-session' }
  | { kind: 'session-expired' }               // refus définitif : compte retiré
  | { kind: 'unavailable';     reason: string } // réseau/serveur : session conservée

/** Renouvelle un token dès qu'il lui reste moins d'une heure (sur 7 jours). */
export const REFRESH_THRESHOLD_S = 3600

const LOGIN_MESSAGES: Record<number, string> = {
  401: 'Identifiants incorrects.',
  403: 'Accès refusé ! Vérifie que ton compte est activé et que ton e-mail est confirmé.',
  429: 'Trop de tentatives ! Réessaie dans quelques minutes.',
  500: 'Erreur interne du serveur (500) ! Réessaie plus tard.',
  502: 'Le serveur est inaccessible (502) !',
  503: 'Le service est temporairement indisponible (503) !',
  504: 'Le serveur a mis trop de temps à répondre (504) !',
}

/** L'API peut renvoyer l'expiration en ms (> 1e12) : on normalise en secondes. */
export function normalizeExpires(expires: number): number {
  return expires > 1e12 ? Math.floor(expires / 1000) : expires
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** Valide la forme d'une réponse login/refresh - jamais de token vide ou mal typé. */
function parseTokenFields(data: unknown): { token: string; expires: number; dev: boolean | undefined } | null {
  if (!isObject(data)) return null
  const { token, expires } = data
  if (typeof token !== 'string' || token.length === 0) return null
  if (typeof expires !== 'number' || !Number.isFinite(expires) || expires <= 0) return null
  const dev = typeof data.dev_server_access === 'boolean' ? data.dev_server_access : undefined
  return { token, expires: normalizeExpires(expires), dev }
}

export function toPublicAccount(account: Account, nowSeconds: number): PublicAccount {
  return {
    username:           account.username,
    uuid:               account.uuid,
    isAdmin:            account.isAdmin,
    canAccessDevServer: account.canAccessDevServer,
    stale:              account.tokenExpires <= nowSeconds,
  }
}

export function createAuthService(deps: AuthDeps) {
  const { transport, now } = deps
  const log = deps.log ?? (() => {})

  /** Un refresh en cours par compte : les appelants concurrents partagent la même promesse. */
  const inflightRefresh = new Map<string, Promise<RefreshOutcome>>()

  const emit = (event: AuthEvent) => { try { deps.onEvent?.(event) } catch { /* un listener ne doit jamais casser l'auth */ } }

  // ── Lecture ────────────────────────────────────────────────────────────────

  function findAccount(uuid: string): Account | null {
    return deps.getAccounts().find(a => a.uuid === uuid) ?? null
  }

  function getActive(): Account | null {
    const accounts = deps.getAccounts()
    if (accounts.length === 0) return null
    const activeId = deps.getActiveId()
    const active   = activeId ? accounts.find(a => a.uuid === activeId) : undefined
    if (active) return active
    // Identifiant actif absent ou orphelin alors que des comptes existent : on se
    // replie sur le premier plutôt que d'afficher « déconnecté » à tort.
    deps.setActiveId(accounts[0].uuid)
    return accounts[0]
  }

  function listPublic(): Array<{ username: string; uuid: string; isAdmin: boolean }> {
    return deps.getAccounts().map(({ username, uuid, isAdmin }) => ({ username, uuid, isAdmin }))
  }

  // ── Écriture ───────────────────────────────────────────────────────────────

  function upsert(account: Account): void {
    const accounts = deps.getAccounts()
    const idx = accounts.findIndex(a => a.uuid === account.uuid)
    if (idx >= 0) accounts[idx] = account
    else accounts.push(account)
    deps.setAccounts(accounts)
  }

  /**
   * Retire un compte et ses credentials de TOUS les emplacements gérés ici.
   * Ne touche à aucun processus : le jeu déjà lancé n'est pas concerné.
   */
  function remove(uuid: string, reason: 'logout' | 'remove' | 'expired'): Account | null {
    const accounts = deps.getAccounts().filter(a => a.uuid !== uuid)
    deps.setAccounts(accounts)
    inflightRefresh.delete(uuid)
    if (deps.getActiveId() === uuid) {
      const next = accounts[0] ?? null
      deps.setActiveId(next?.uuid ?? null)
    }
    emit({ type: 'accounts-changed', reason })
    return getActive()
  }

  function switchTo(uuid: string): Account | null {
    const target = findAccount(uuid)
    if (!target) return null
    deps.setActiveId(uuid)
    emit({ type: 'accounts-changed', reason: 'switch' })
    return target
  }

  // ── Login ──────────────────────────────────────────────────────────────────

  async function login(username: string, password: string): Promise<LoginResult> {
    let res: HttpResponse
    try {
      res = await transport('/auth/launcher/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, password }),
      })
    } catch {
      return { ok: false, code: 0, message: 'Impossible de contacter le serveur ! Vérifie ta connexion.' }
    }

    if (res.status < 200 || res.status >= 300) {
      return { ok: false, code: res.status, message: LOGIN_MESSAGES[res.status] ?? `Erreur ${res.status} !` }
    }

    let data: unknown
    try { data = await res.json() } catch { data = null }
    const fields = parseTokenFields(data)
    const serverUsername = isObject(data) && typeof data.username === 'string' ? data.username : ''
    if (!fields || !serverUsername) {
      return { ok: false, code: res.status, message: 'Réponse invalide du serveur.' }
    }

    const account: Account = {
      username:           serverUsername,
      uuid:               deps.makeUuid(serverUsername),
      token:              fields.token,
      tokenExpires:       fields.expires,
      isAdmin:            isObject(data) && data.is_admin === true,
      canAccessDevServer: fields.dev ?? false,
    }

    upsert(account)
    deps.setActiveId(account.uuid)
    emit({ type: 'accounts-changed', reason: 'login' })
    return { ok: true, account }
  }

  // ── Refresh (single-flight) ───────────────────────────────────────────────

  function refresh(uuid: string): Promise<RefreshOutcome> {
    const existing = inflightRefresh.get(uuid)
    if (existing) return existing

    const promise = doRefresh(uuid).finally(() => {
      // Ne supprime que sa propre entrée (le compte a pu être retiré puis recréé).
      if (inflightRefresh.get(uuid) === promise) inflightRefresh.delete(uuid)
    })
    inflightRefresh.set(uuid, promise)
    return promise
  }

  async function doRefresh(uuid: string): Promise<RefreshOutcome> {
    const account = findAccount(uuid)
    if (!account) return { kind: 'gone' }
    const sentToken = account.token
    if (!sentToken) return { kind: 'invalid' }   // token illisible : inutile d'interroger le serveur

    let res: HttpResponse
    try {
      res = await transport('/auth/launcher/refresh-token', {
        method:  'POST',
        headers: { Authorization: `Bearer ${sentToken}` },
      })
    } catch {
      return { kind: 'transient', reason: 'network' }
    }

    if (res.status === 401 || res.status === 403) return { kind: 'invalid' }
    if (res.status < 200 || res.status >= 300) return { kind: 'transient', reason: `http-${res.status}` }

    let data: unknown
    try { data = await res.json() } catch { return { kind: 'transient', reason: 'bad-json' } }
    if (isObject(data) && data.success === false) return { kind: 'invalid' }
    const fields = parseTokenFields(data)
    if (!fields) return { kind: 'transient', reason: 'bad-payload' }

    // Le compte a pu être retiré (déconnexion) pendant l'appel : on ne le ressuscite pas.
    const current = findAccount(uuid)
    if (!current) return { kind: 'gone' }

    const updated: Account = {
      ...current,
      token:              fields.token,
      tokenExpires:       fields.expires,
      canAccessDevServer: fields.dev ?? current.canAccessDevServer,
    }
    upsert(updated)
    emit({ type: 'accounts-changed', reason: 'refresh' })
    return { kind: 'ok', account: updated }
  }

  /** Applique un refus définitif : retire le compte et prévient l'interface. */
  function expire(account: Account): void {
    log(`Auth: session expirée pour ${account.username} - compte retiré`)
    remove(account.uuid, 'expired')
    emit({ type: 'session-expired', uuid: account.uuid, username: account.username })
  }

  // ── Compte actif (démarrage de l'app, lancement) ──────────────────────────

  /**
   * Compte actif prêt à l'emploi. Renouvelle le token s'il approche de son
   * expiration. Une erreur transitoire (réseau, 5xx) ne déconnecte JAMAIS :
   * le compte reste en place, marqué `stale` s'il est expiré localement.
   * Seul un refus définitif du serveur retire le compte.
   */
  async function getAccount(): Promise<Account | null> {
    for (let guard = 0; guard < 8; guard++) {
      const account = getActive()
      if (!account) return null
      if (account.tokenExpires - now() > REFRESH_THRESHOLD_S) return account

      const outcome = await refresh(account.uuid)
      if (outcome.kind === 'ok')        return outcome.account
      if (outcome.kind === 'transient') return findAccount(account.uuid) ?? null
      if (outcome.kind === 'invalid')   { expire(account); continue }  // bascule sur le compte suivant, s'il y en a un
      // 'gone' : déconnexion pendant l'appel → on relit l'état
    }
    return getActive()
  }

  // ── Requêtes authentifiées ────────────────────────────────────────────────

  /**
   * Point d'entrée unique pour tout appel serveur qui exige un compte.
   *  - lit le token au dernier moment (jamais une copie périmée) ;
   *  - renouvelle avant l'appel si le token approche de l'expiration ;
   *  - sur 401, renouvelle UNE fois puis rejoue UNE fois (jamais de boucle) ;
   *  - si un autre appelant a déjà fait tourner le token, rejoue simplement avec le nouveau.
   */
  async function authedRequest(path: string, init: HttpInit = {}, uuid?: string): Promise<AuthedResult> {
    const target = uuid ?? deps.getActiveId()
    if (!target) return { kind: 'no-session' }

    let account = findAccount(target)
    if (!account) return { kind: 'no-session' }

    if (account.tokenExpires - now() <= REFRESH_THRESHOLD_S) {
      const pre = await refresh(target)
      if (pre.kind === 'invalid') { expire(account); return { kind: 'session-expired' } }
      if (pre.kind === 'gone')    return { kind: 'no-session' }
      // ok / transient : on tente l'appel avec le token courant
      account = findAccount(target)
      if (!account) return { kind: 'no-session' }
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const used = account.token
      let res: HttpResponse
      try {
        res = await transport(path, {
          ...init,
          headers: { ...init.headers, Authorization: `Bearer ${used}` },
        })
      } catch {
        return { kind: 'unavailable', reason: 'network' }
      }

      if (res.status !== 401) return { kind: 'response', res }
      // 401 persistant alors que le token vient d'être renouvelé avec succès : ce
      // n'est plus la session qui est en cause (le serveur vient de l'émettre) mais
      // la route elle-même. On rend la réponse à l'appelant sans déconnecter -
      // seul un refus du refresh-token lui-même met fin à la session.
      if (attempt === 1)      return { kind: 'response', res }

      // 401 : le token a-t-il déjà été renouvelé par un autre appelant ?
      const latest = findAccount(target)
      if (!latest) return { kind: 'no-session' }
      if (latest.token !== used) { account = latest; continue }

      const outcome = await refresh(target)
      if (outcome.kind === 'ok')        { account = outcome.account; continue }
      if (outcome.kind === 'invalid')   { expire(latest); return { kind: 'session-expired' } }
      if (outcome.kind === 'gone')      return { kind: 'no-session' }
      return { kind: 'unavailable', reason: outcome.reason }
    }
    return { kind: 'unavailable', reason: 'exhausted' }
  }

  return {
    login,
    getAccount,
    getActive,
    listPublic,
    switchTo,
    remove,
    refresh,
    authedRequest,
    findAccount,
  }
}

export type AuthService = ReturnType<typeof createAuthService>
