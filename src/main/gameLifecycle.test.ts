/**
 * Scénarios « session du launcher ↔ jeu déjà lancé ».
 *
 * Le jeu est représenté par un faux lancement (pas de vrai Minecraft ici) : ces
 * tests verrouillent le CONTRAT de découplage - aucune opération d'authentification
 * n'arrête, n'invalide ni ne remplace une session de jeu - et la façon dont le
 * launcher câble réellement les deux (voir les garde-fous de source en bas).
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createGameSession } from './gameSession'
import { createHarness, TOKEN_TTL } from './testing/fakeServer'

/** Démarre un « jeu » pour le compte actif, comme launch:start (réservation → attache). */
async function startGame(h: ReturnType<typeof createHarness>, name = 'Alice') {
  const login = await h.auth.login(name, 'pw')
  if (!login.ok) throw new Error('login')
  const account = login.account

  const session = createGameSession()
  expect(session.acquire({ uuid: account.uuid, username: account.username })).toBe(true)

  // Jeton de lancement à usage unique : le SEUL credential que le jeu emporte.
  const gt = await h.auth.authedRequest('/auth/launcher/game-token', { method: 'POST' }, account.uuid)
  expect(gt.kind).toBe('response')

  const kill = vi.fn()
  session.attach({ kill })
  return { session, account, kill }
}

describe('jeu lancé ↔ session du launcher', () => {
  it('connexion puis lancement : la session est active et appartient au compte', async () => {
    const h = createHarness()
    const { session, account } = await startGame(h)
    expect(session.isRunning()).toBe(true)
    expect(session.getOwner()).toEqual({ uuid: account.uuid, username: 'Alice' })
    expect(h.server.state.gameTokens).toBe(1)
  })

  it('déconnexion du launcher pendant que le jeu tourne : le jeu continue', async () => {
    const h = createHarness()
    const { session, account, kill } = await startGame(h)

    h.auth.remove(account.uuid, 'logout')

    expect(h.stored()).toHaveLength(0)
    expect(session.isRunning()).toBe(true)
    expect(kill).not.toHaveBeenCalled()
    expect(session.getOwner()?.uuid).toBe(account.uuid)
  })

  it('expiration du token pendant que le jeu tourne : le jeu continue, la session launcher est fermée proprement', async () => {
    const h = createHarness()
    const { session, kill } = await startGame(h)

    h.advance(TOKEN_TTL + 3 * 3600)                    // token mort, au-delà de la grâce
    expect(await h.auth.getAccount()).toBeNull()

    expect(session.isRunning()).toBe(true)
    expect(kill).not.toHaveBeenCalled()
  })

  it('renouvellement du token pendant que le jeu tourne : aucun effet sur le jeu', async () => {
    const h = createHarness()
    const { session, account, kill } = await startGame(h)

    h.advance(TOKEN_TTL - 600)
    const refreshed = await h.auth.getAccount()

    expect(refreshed?.token).not.toBe(account.token)   // le token launcher a tourné
    expect(session.isRunning()).toBe(true)
    expect(kill).not.toHaveBeenCalled()
    expect(h.server.state.gameTokens).toBe(1)          // aucun nouveau jeton de lancement
  })

  it('échec du renouvellement (serveur injoignable) : le jeu continue et la session est conservée', async () => {
    const h = createHarness()
    const { session, kill } = await startGame(h)
    h.advance(TOKEN_TTL - 600)
    h.server.state.offline = true

    expect((await h.auth.getAccount())?.username).toBe('Alice')
    expect(h.stored()).toHaveLength(1)
    expect(session.isRunning()).toBe(true)
    expect(kill).not.toHaveBeenCalled()
  })

  it('déconnexion puis reconnexion du même compte : le jeu en cours n\'est ni touché ni dupliqué', async () => {
    const h = createHarness()
    const { session, account, kill } = await startGame(h)

    h.auth.remove(account.uuid, 'logout')
    const again = await h.auth.login('Alice', 'pw')
    expect(again.ok).toBe(true)

    expect(session.isRunning()).toBe(true)
    expect(kill).not.toHaveBeenCalled()
    // Le launcher est de nouveau « connecté » mais ne peut pas lancer une seconde instance.
    expect(session.acquire({ uuid: account.uuid, username: 'Alice' })).toBe(false)
  })

  it('changement de compte pendant que le jeu tourne : le jeu garde son identité, rien ne fuit vers l\'autre compte', async () => {
    const h = createHarness()
    const { session, account: alice, kill } = await startGame(h, 'Alice')

    const bob = await h.auth.login('Bob', 'pw')
    if (!bob.ok) throw new Error('login')
    expect(h.activeId()).toBe(bob.account.uuid)

    expect(session.getOwner()?.uuid).toBe(alice.uuid)          // propriétaire inchangé
    expect(kill).not.toHaveBeenCalled()
    // Bob ne peut pas « emprunter » la session ni lancer un second jeu par-dessus.
    expect(session.acquire({ uuid: bob.account.uuid, username: 'Bob' })).toBe(false)
    expect(session.getOwner()?.uuid).toBe(alice.uuid)

    // Les appels de Bob utilisent le token de Bob, jamais celui d'Alice.
    h.server.state.calls.length = 0
    await h.auth.authedRequest('/launcher/player')
    expect(h.server.state.calls.every(c => c.bearer === bob.account.token)).toBe(true)
  })

  it('un jeu fermé libère la session ; le compte, lui, n\'est pas modifié', async () => {
    const h = createHarness()
    const { session, account } = await startGame(h)

    session.release()                                          // fermeture du jeu

    expect(session.isRunning()).toBe(false)
    expect(h.stored()).toHaveLength(1)
    expect(h.auth.getActive()?.uuid).toBe(account.uuid)
    expect(session.acquire({ uuid: account.uuid, username: 'Alice' })).toBe(true)  // on peut relancer
  })

  it('double clic « Jouer » : la réservation empêche deux autorisations de lancement', async () => {
    const session = createGameSession()
    expect(session.acquire({ uuid: 'u1', username: 'Alice' })).toBe(true)
    expect(session.acquire({ uuid: 'u1', username: 'Alice' })).toBe(false)
    expect(session.isBusy()).toBe(true)
    expect(session.isRunning()).toBe(false)                    // pas encore de processus
    session.release()
    expect(session.acquire({ uuid: 'u1', username: 'Alice' })).toBe(true)
  })
})

// ── Garde-fous de câblage ────────────────────────────────────────────────────
// Ces assertions lisent le source : elles échouent si quelqu'un réintroduit un
// couplage jeu ↔ session ou une fuite de credential que ce lot de corrections retire.
const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8')

describe('garde-fous de câblage (launcherCore / index)', () => {
  const core = read('launcherCore.ts')
  const index = read('index.ts')

  it('le jeu est lancé détaché : il survit à la fermeture du launcher', () => {
    expect(core).toMatch(/detached:\s+true/)
  })

  it('le token de session du launcher n\'est pas transmis au jeu', () => {
    expect(core).not.toContain('ek.launcher.token')
    expect(core).not.toMatch(/access_token:\s+account\.token/)
    expect(core).not.toMatch(/writeFileSync\([^)]*ek_auth/)
  })

  it('aucun handler d\'authentification n\'arrête le jeu', () => {
    for (const handler of ['auth:logout', 'auth:switchAccount', 'auth:removeAccount', 'auth:resetToken']) {
      const at = index.indexOf(`ipcMain.handle('${handler}'`)
      expect(at, handler).toBeGreaterThan(-1)
      const body = index.slice(at, index.indexOf('\n})', at))
      expect(body, handler).not.toMatch(/stopLaunch|gameSession\.(stop|release)/)
    }
  })

  it('le renderer ne reçoit jamais de token', () => {
    expect(index).not.toMatch(/return\s+account\s*$/m)
    expect(index).not.toMatch(/token=\$\{account\.token/)
    expect(index).not.toContain('account.token?.slice')
  })
})
