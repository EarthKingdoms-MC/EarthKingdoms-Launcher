import { describe, it, expect } from 'vitest'
import { createHarness, DAY, TOKEN_TTL } from './testing/fakeServer'

async function loggedIn(name = 'Alice') {
  const h = createHarness()
  const r = await h.auth.login(name, 'pw')
  if (!r.ok) throw new Error('login failed')
  return { h, account: r.account }
}

describe('authService - connexion', () => {
  it('connecte, enregistre le compte et le définit actif', async () => {
    const { h, account } = await loggedIn()
    expect(h.activeId()).toBe(account.uuid)
    expect(h.stored()).toHaveLength(1)
    expect(h.auth.listPublic()).toEqual([{ username: 'Alice', uuid: account.uuid, isAdmin: false }])
  })

  it('refuse des identifiants incorrects sans rien enregistrer', async () => {
    const h = createHarness()
    const r = await h.auth.login('Alice', 'mauvais')
    expect(r).toMatchObject({ ok: false, code: 401 })
    expect(h.stored()).toHaveLength(0)
  })

  it('rapporte une panne réseau sans lever', async () => {
    const h = createHarness()
    h.server.state.offline = true
    expect(await h.auth.login('Alice', 'pw')).toMatchObject({ ok: false, code: 0 })
  })
})

describe('authService - renouvellement', () => {
  it('ne contacte pas le serveur tant que le token est frais', async () => {
    const { h } = await loggedIn()
    const before = h.server.state.calls.length
    const acc = await h.auth.getAccount()
    expect(acc?.username).toBe('Alice')
    expect(h.server.state.calls.length).toBe(before)
  })

  it('renouvelle avant expiration et persiste le nouveau token', async () => {
    const { h, account } = await loggedIn()
    h.advance(TOKEN_TTL - 600)                       // il reste 10 min
    const acc = await h.auth.getAccount()
    expect(acc?.token).not.toBe(account.token)
    expect(h.stored()[0].token).toBe(acc?.token)
    expect(h.server.state.refreshes).toBe(1)
  })

  it('plusieurs requêtes simultanées ne déclenchent qu\'un seul renouvellement', async () => {
    const { h } = await loggedIn()
    h.advance(TOKEN_TTL - 600)
    const results = await Promise.all(
      Array.from({ length: 8 }, () => h.auth.authedRequest('/launcher/player'))
    )
    expect(results.every(r => r.kind === 'response' && r.res.status === 200)).toBe(true)
    expect(h.server.state.refreshes).toBe(1)
    // La rotation est à usage unique : sans single-flight, 7 des 8 appels auraient reçu un 401.
    expect(h.events.some(e => e.type === 'session-expired')).toBe(false)
  })

  it('sur 401, renouvelle une fois puis rejoue la requête', async () => {
    const { h, account } = await loggedIn()
    // Le serveur considère le token expiré depuis 1 min (donc dans sa grâce de
    // 30 min) alors que l'horloge locale le croit encore valable : cas réel d'un
    // décalage d'horloge.
    h.server.tokens.set(account.token, { user: 'Alice', expires: h.clock.now - 60 })
    const r = await h.auth.authedRequest('/launcher/player')
    expect(r.kind).toBe('response')
    expect(h.server.state.refreshes).toBe(1)
  })

  it('un refus définitif retire le compte, prévient l\'interface et ne boucle pas', async () => {
    const { h, account } = await loggedIn()
    h.server.state.deniedUsers.add('Alice')
    const r = await h.auth.authedRequest('/launcher/player')
    expect(r.kind).toBe('session-expired')
    expect(h.stored()).toHaveLength(0)
    expect(h.activeId()).toBeNull()
    expect(h.events).toContainEqual({ type: 'session-expired', uuid: account.uuid, username: 'Alice' })
    expect(h.server.state.refreshes).toBeLessThanOrEqual(1)   // jamais de boucle de requêtes
  })

  it('un 401 persistant d\'une route après un refresh réussi ne déconnecte pas', async () => {
    const { h } = await loggedIn()
    h.server.state.routeStatus.set('/skin/history/restore/9', 401)   // route qui n'accepte pas ce type de token
    const r = await h.auth.authedRequest('/skin/history/restore/9', { method: 'POST' })
    expect(r.kind).toBe('response')
    expect(r.kind === 'response' && r.res.status).toBe(401)
    expect(h.stored()).toHaveLength(1)                         // session conservée
    expect(h.server.state.refreshes).toBe(1)                   // un seul refresh, un seul rejeu
  })
})

describe('authService - perte réseau et erreurs serveur', () => {
  it('une coupure réseau ne déconnecte jamais, même token expiré localement', async () => {
    const { h } = await loggedIn()
    h.advance(TOKEN_TTL + 3 * DAY)                   // très au-delà de l'expiration
    h.server.state.offline = true
    const acc = await h.auth.getAccount()
    expect(acc?.username).toBe('Alice')              // compte conservé (marqué périmé côté UI)
    expect(h.stored()).toHaveLength(1)
    expect(h.events.some(e => e.type === 'session-expired')).toBe(false)
  })

  it('la session se rétablit au retour du réseau tant que le serveur accepte le token', async () => {
    const { h } = await loggedIn()
    h.advance(TOKEN_TTL - 600)
    h.server.state.offline = true
    expect((await h.auth.authedRequest('/launcher/player')).kind).toBe('unavailable')
    expect(h.stored()).toHaveLength(1)
    h.server.state.offline = false
    expect((await h.auth.authedRequest('/launcher/player')).kind).toBe('response')
  })

  it('une erreur 500 au refresh est transitoire : aucune déconnexion', async () => {
    const { h } = await loggedIn()
    h.advance(TOKEN_TTL - 600)
    h.server.state.refreshStatus = 500
    await h.auth.getAccount()
    expect(h.stored()).toHaveLength(1)
    h.server.state.refreshStatus = 429
    await h.auth.getAccount()
    expect(h.stored()).toHaveLength(1)
  })

  it('une réponse de refresh malformée n\'écrase pas le token existant', async () => {
    const { h, account } = await loggedIn()
    h.advance(TOKEN_TTL - 600)
    h.server.state.refreshPayload = { success: true, token: '', expires: 'bientôt' }
    const acc = await h.auth.getAccount()
    expect(acc?.token).toBe(account.token)
    expect(h.stored()[0].token).toBe(account.token)
  })

  it('un token expiré au-delà de la grâce serveur est refusé : compte retiré proprement', async () => {
    const { h } = await loggedIn()
    h.advance(TOKEN_TTL + 2 * 3600)                  // > 30 min après expiration
    expect(await h.auth.getAccount()).toBeNull()
    expect(h.stored()).toHaveLength(0)
  })
})

describe('authService - déconnexion, reconnexion, changement de compte', () => {
  it('déconnexion puis reconnexion du même compte : état propre, un seul enregistrement', async () => {
    const { h, account } = await loggedIn()
    h.auth.remove(account.uuid, 'logout')
    expect(h.stored()).toHaveLength(0)
    expect(h.auth.getActive()).toBeNull()
    expect((await h.auth.authedRequest('/launcher/player')).kind).toBe('no-session')

    const again = await h.auth.login('Alice', 'pw')
    expect(again.ok).toBe(true)
    expect(h.stored()).toHaveLength(1)
    expect(h.stored()[0].token).not.toBe(account.token)   // l'ancien token n'est conservé nulle part
  })

  it('le token d\'un compte déconnecté ne peut plus servir à de nouvelles opérations', async () => {
    const { h, account } = await loggedIn()
    h.auth.remove(account.uuid, 'logout')
    const calls = h.server.state.calls.length
    const r = await h.auth.authedRequest('/launcher/player', {}, account.uuid)
    expect(r.kind).toBe('no-session')
    expect(h.server.state.calls.length).toBe(calls)       // aucune requête partie avec l'ancien token
  })

  it('changement de compte : chaque requête utilise le token de SON compte', async () => {
    const { h, account: a } = await loggedIn('Alice')
    const b = await h.auth.login('Bob', 'pw')
    if (!b.ok) throw new Error('login')
    expect(h.activeId()).toBe(b.account.uuid)

    await h.auth.authedRequest('/launcher/player', {}, a.uuid)
    await h.auth.authedRequest('/launcher/player', {}, b.account.uuid)
    const last2 = h.server.state.calls.slice(-2)
    expect(last2[0].bearer).toBe(a.token)
    expect(last2[1].bearer).toBe(b.account.token)

    h.auth.switchTo(a.uuid)
    expect(h.auth.getActive()?.username).toBe('Alice')
  })

  it('retirer le compte actif bascule sur le suivant', async () => {
    const { h, account: a } = await loggedIn('Alice')
    const b = await h.auth.login('Bob', 'pw')
    if (!b.ok) throw new Error('login')
    const next = h.auth.remove(b.account.uuid, 'remove')
    expect(next?.uuid).toBe(a.uuid)
    expect(h.activeId()).toBe(a.uuid)
  })

  it('déconnexion pendant un refresh en vol : le compte n\'est pas ressuscité', async () => {
    const { h, account } = await loggedIn()
    h.advance(TOKEN_TTL - 600)
    const pending = h.auth.refresh(account.uuid)
    h.auth.remove(account.uuid, 'logout')            // l'utilisateur se déconnecte entre-temps
    await pending
    expect(h.stored()).toHaveLength(0)
    expect(h.activeId()).toBeNull()
  })

  it('un identifiant actif orphelin retombe sur un compte existant plutôt que « déconnecté »', async () => {
    const { h, account } = await loggedIn()
    h.setActive('uuid-fantome')                       // état corrompu
    expect(h.auth.getActive()?.uuid).toBe(account.uuid)
    expect(h.activeId()).toBe(account.uuid)           // et l'état est réparé
  })
})

describe('authService - confidentialité', () => {
  it('aucun token n\'apparaît dans les journaux, quels que soient les scénarios', async () => {
    const { h, account } = await loggedIn()
    h.advance(TOKEN_TTL - 600)
    await h.auth.authedRequest('/launcher/player')
    h.server.state.deniedUsers.add('Alice')
    await h.auth.authedRequest('/launcher/player')
    const secrets = [account.token, ...h.server.tokens.keys()]
    for (const line of h.logs) {
      for (const s of secrets) expect(line).not.toContain(s)
    }
  })
})
