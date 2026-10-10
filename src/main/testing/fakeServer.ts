/**
 * Faux serveur EarthKingdoms pour les tests : modélise le contrat réel des
 * routes /auth/launcher/* (tokens de 7 jours, rotation à usage unique au refresh,
 * grâce de 30 min) sans réseau. Chaque appel cède la main (await) pour que des
 * requêtes concurrentes s'entrelacent réellement.
 */
import type { Account, AuthEvent, HttpInit, HttpResponse } from '../authService'
import { createAuthService } from '../authService'

export const DAY = 24 * 3600
export const TOKEN_TTL = 7 * DAY

export interface ServerCall { path: string; method: string; bearer: string | null }

export function createFakeServer(clock: { now: number }) {
  let seq = 0
  const tokens = new Map<string, { user: string; expires: number }>()
  const state = {
    offline:        false,
    refreshStatus:  null as number | null,   // force un statut sur /refresh-token
    refreshPayload: null as unknown,         // force un corps sur /refresh-token
    routeStatus:    new Map<string, number>(), // force un statut sur une route
    gameTokens:     0,
    refreshes:      0,
    calls:          [] as ServerCall[],
    deniedUsers:    new Set<string>(),
  }

  function issue(user: string): { token: string; expires: number } {
    const token = `tok-${user}-${++seq}`
    const expires = clock.now + TOKEN_TTL
    tokens.set(token, { user, expires })
    return { token, expires }
  }

  const json = (status: number, body: unknown): HttpResponse => ({ status, json: async () => body })

  async function handle(path: string, init: HttpInit = {}): Promise<HttpResponse> {
    await Promise.resolve()   // laisse les appels concurrents s'entrelacer
    if (state.offline) throw new Error('ENETUNREACH')
    const auth   = init.headers?.Authorization ?? null
    const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null
    state.calls.push({ path, method: init.method ?? 'GET', bearer })
    await Promise.resolve()

    if (path === '/auth/launcher/login') {
      const { username, password } = JSON.parse(init.body as string) as { username: string; password: string }
      if (password !== 'pw') return json(401, { error: 'Identifiants incorrects.' })
      const { token, expires } = issue(username)
      return json(200, { token, expires, username, is_admin: false, dev_server_access: false })
    }

    const entry = bearer ? tokens.get(bearer) : undefined
    // Grâce de 30 min après expiration, uniquement pour le refresh (voir refresh-token/route.ts)
    const graceOk = entry && entry.expires > clock.now - 1800
    const valid   = entry && entry.expires > clock.now && !state.deniedUsers.has(entry.user)

    if (path === '/auth/launcher/refresh-token') {
      state.refreshes++
      if (state.refreshStatus) return json(state.refreshStatus, { error: 'forced' })
      if (!entry || !graceOk || state.deniedUsers.has(entry.user)) return json(401, { error: 'Token invalide ou expiré.' })
      tokens.delete(bearer!)                                  // rotation : l'ancien token meurt
      const next = issue(entry.user)
      if (state.refreshPayload !== null) return json(200, state.refreshPayload)
      return json(200, { success: true, token: next.token, expires: next.expires, dev_server_access: false })
    }

    const forced = state.routeStatus.get(path)
    if (forced) return json(forced, { error: 'forced' })
    if (!valid) return json(401, { error: 'Non authentifié' })

    if (path === '/auth/launcher/game-token') {
      state.gameTokens++
      return json(200, { token: `game-${state.gameTokens}`, expiresAt: clock.now + 90 })
    }
    return json(200, { ok: true, user: entry!.user })
  }

  return { state, tokens, handle, issue }
}

/** Harnais complet : stockage mémoire + faux serveur + service d'authentification. */
export function createHarness() {
  const clock    = { now: 1_800_000_000 }
  const server   = createFakeServer(clock)
  let accounts: Account[] = []
  let activeId: string | null = null
  const events: AuthEvent[] = []
  const logs: string[] = []

  const auth = createAuthService({
    getAccounts: () => accounts.map(a => ({ ...a })),
    setAccounts: (next) => { accounts = next.map(a => ({ ...a })) },
    getActiveId: () => activeId,
    setActiveId: (id) => { activeId = id },
    transport:   (path, init) => server.handle(path, init),
    now:         () => clock.now,
    makeUuid:    (u) => `uuid-${u}`,
    onEvent:     (e) => events.push(e),
    log:         (m) => logs.push(m),
  })

  return {
    auth, server, clock, events, logs,
    stored: () => accounts,
    activeId: () => activeId,
    setActive: (id: string | null) => { activeId = id },
    advance: (seconds: number) => { clock.now += seconds },
  }
}
