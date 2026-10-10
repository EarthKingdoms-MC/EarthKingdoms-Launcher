import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { createHarness } from './testing/fakeServer'
import {
  createSkinService, createSerialQueue, validateSkinPng, resolveSkinUrl,
  SKIN_MAX_BYTES,
} from './skins'

// ── Fabrique de PNG minimaux (signature + IHDR, suffisant pour la validation) ──
function png(width: number, height: number, tag = 0, pad = 0): Uint8Array {
  const out = new Uint8Array(33 + pad)
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  const v = new DataView(out.buffer)
  v.setUint32(8, 13)
  out.set([0x49, 0x48, 0x44, 0x52], 12)       // "IHDR"
  v.setUint32(16, width)
  v.setUint32(20, height)
  out[24] = 8; out[25] = 6; out[28] = tag      // « tag » rend deux images différentes
  return out
}
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

describe('validation des skins', () => {
  it('accepte un PNG 64×64', () => {
    expect(validateSkinPng(png(64, 64))).toEqual({ ok: true })
  })
  it('refuse 64×32, 128×128, non-PNG, vide et trop gros', () => {
    expect(validateSkinPng(png(64, 32))).toMatchObject({ ok: false })
    expect(validateSkinPng(png(128, 128))).toMatchObject({ ok: false })
    expect(validateSkinPng(new Uint8Array(40))).toMatchObject({ ok: false })
    expect(validateSkinPng(new Uint8Array(0))).toMatchObject({ ok: false })
    expect(validateSkinPng(png(64, 64, 0, SKIN_MAX_BYTES))).toMatchObject({ ok: false })
  })
  it('n\'accepte que les URL de skins du site', () => {
    expect(resolveSkinUrl('/skins/alice.png')).toBe('https://earthkingdoms-mc.fr/skins/alice.png')
    expect(resolveSkinUrl('https://earthkingdoms-mc.fr/skins/a.png')).toContain('earthkingdoms-mc.fr')
    expect(resolveSkinUrl('https://evil.example/skins/a.png')).toBeNull()
    expect(resolveSkinUrl('http://earthkingdoms-mc.fr/skins/a.png')).toBeNull()
    expect(resolveSkinUrl('file:///etc/passwd')).toBeNull()
  })
})

// ── Faux serveur de skins branché sur le vrai service d'authentification ────────
type RestoreMode = 'dedupe' | 'ok-new-entry' | 'unauthorized-route'

async function setup(restoreMode: RestoreMode = 'dedupe') {
  const h = createHarness()
  const login = await h.auth.login('Alice', 'pw')
  if (!login.ok) throw new Error('login')

  // Fichiers et historique côté « serveur »
  const files = new Map<string, Uint8Array>()     // url → octets
  const history: Array<{ id: number; url: string; at: number }> = []
  let nextId = 1
  let activeBytes: Uint8Array | null = null
  let activeOverride: Uint8Array | null = null   // force ce que sert /skins/alice.png
  const stats = { uploads: 0, restores: 0, downloads: 0 }

  function addEntry(bytes: Uint8Array): number {
    const id = nextId++
    const url = `/skins/alice_${id}.png`
    files.set(url, bytes)
    history.unshift({ id, url, at: ++h.clock.now })
    activeBytes = bytes
    return id
  }

  // Les routes skin du faux serveur s'appuient sur le contrat réel
  const originalHandle = h.server.handle
  h.server.handle = async (path, init) => {
    if (path === '/skin/history/list') {
      const base = await originalHandle('/launcher/player', init)    // valide le bearer
      if (base.status !== 200) return base
      const sorted = [...history].sort((a, b) => b.at - a.at)
      return { status: 200, json: async () => ({ history: sorted.map((e, i) => ({
        id: e.id, skin_url: e.url, created_at: null, is_current: i === 0,
      })) }) }
    }
    if (path.startsWith('/skin/history/restore/')) {
      const base = await originalHandle('/launcher/player', init)
      if (restoreMode === 'unauthorized-route') return { status: 401, json: async () => ({ ok: false, error: 'Non authentifié' }) }
      if (base.status !== 200) return base
      stats.restores++
      const id = Number(path.split('/').pop())
      const entry = history.find(e => e.id === id)
      if (!entry) return { status: 404, json: async () => ({ ok: false, error: 'Skin non trouvé dans votre historique.' }) }
      if (restoreMode === 'dedupe') entry.at = ++h.clock.now              // remonte l'entrée existante
      else addEntry(files.get(entry.url)!)                                // ancien serveur : nouvelle ligne
      activeBytes = files.get(entry.url)!
      return { status: 200, json: async () => ({ ok: true }) }
    }
    if (path === '/skin/upload') {
      const base = await originalHandle('/launcher/player', init)
      if (base.status !== 200) return base
      stats.uploads++
      // Extrait le PNG du corps multipart (latin1 : une position = un octet).
      const body  = init!.body as Uint8Array
      const text  = new TextDecoder('latin1').decode(body)
      const start = text.indexOf('\r\n\r\n') + 4
      const end   = text.lastIndexOf('\r\n--BOUNDARY--')
      addEntry(body.slice(start, end))
      return { status: 200, json: async () => ({ ok: true, skin_url: '/skins/alice.png' }) }
    }
    return originalHandle(path, init)
  }

  const svc = createSkinService({
    username: 'Alice',
    authed: (p, i) => h.auth.authedRequest(p, i, login.account.uuid),
    fetchBytes: async (url) => {
      stats.downloads++
      const u = new URL(url)
      if (u.pathname === '/skins/alice.png') {
        const served = activeOverride ?? activeBytes
        return served ? { status: 200, bytes: served } : { status: 404, bytes: new Uint8Array() }
      }
      const f = files.get(u.pathname)
      return f ? { status: 200, bytes: f } : { status: 404, bytes: new Uint8Array() }
    },
    sha256: sha,
    newBoundary: () => 'BOUNDARY',
  })

  return {
    h, svc, stats, addEntry, files, login,
    getHistory: () => [...history] as Array<{ id: number }>,
    forceActive: (bytes: Uint8Array | null) => { activeOverride = bytes },
  }
}

describe('skins - ajout, sélection et doublons', () => {
  it('envoie un nouveau skin valide et vérifie qu\'il est réellement appliqué', async () => {
    const { svc, stats, getHistory } = await setup()
    const r = await svc.upload(png(64, 64, 1))
    expect(r).toMatchObject({ ok: true, outcome: 'uploaded', verified: true })
    expect(stats.uploads).toBe(1)
    expect(getHistory()).toHaveLength(1)
  })

  it('réimporter le skin actuel ne crée aucune entrée', async () => {
    const { svc, stats, getHistory } = await setup()
    await svc.upload(png(64, 64, 1))
    const again = await svc.upload(png(64, 64, 1))
    expect(again).toMatchObject({ ok: true, outcome: 'unchanged' })
    expect(stats.uploads).toBe(1)
    expect(getHistory()).toHaveLength(1)
  })

  it('importer un fichier déjà dans l\'historique sélectionne l\'entrée existante (pas de doublon)', async () => {
    const { svc, stats, getHistory } = await setup('dedupe')
    await svc.upload(png(64, 64, 1))      // A
    await svc.upload(png(64, 64, 2))      // B (actuel)
    const r = await svc.upload(png(64, 64, 1))   // A de nouveau
    expect(r).toMatchObject({ ok: true, outcome: 'restored' })
    expect(stats.uploads).toBe(2)         // aucun 3e envoi
    expect(stats.restores).toBe(1)
    expect(getHistory()).toHaveLength(2)  // toujours A et B
    const list = await svc.listHistory()
    expect(list.ok && list.history[0].is_current).toBe(true)
  })

  it('plusieurs importations du même fichier, plusieurs clics : une seule entrée', async () => {
    const { svc, stats, getHistory } = await setup()
    const run = createSerialQueue()
    const file = png(64, 64, 7)
    const results = await Promise.all([1, 2, 3, 4].map(() => run(() => svc.upload(file))))
    expect(results.every(r => r.ok)).toBe(true)
    expect(stats.uploads).toBe(1)
    expect(getHistory()).toHaveLength(1)
  })

  it('deux skins distincts mais visuellement proches ne sont pas fusionnés', async () => {
    const { svc, getHistory } = await setup()
    await svc.upload(png(64, 64, 1))
    await svc.upload(png(64, 64, 2))      // un seul octet de différence
    expect(getHistory()).toHaveLength(2)
  })

  it('refuse localement un fichier invalide sans appel serveur', async () => {
    const { svc, h } = await setup()
    const before = h.server.state.calls.length
    expect(await svc.upload(png(32, 32))).toMatchObject({ ok: false })
    expect(h.server.state.calls.length).toBe(before)
  })
})

describe('skins - restauration', () => {
  it('restaure une entrée de l\'historique (route corrigée) et la vérifie', async () => {
    const { svc, addEntry } = await setup('dedupe')
    const a = addEntry(png(64, 64, 1))
    addEntry(png(64, 64, 2))
    const r = await svc.restore(String(a))
    expect(r).toMatchObject({ ok: true, outcome: 'restored', verified: true })
  })

  it('route de restauration qui refuse le token launcher : repli par re-envoi, skin réellement appliqué, session conservée', async () => {
    const { svc, addEntry, stats, h } = await setup('unauthorized-route')
    const a = addEntry(png(64, 64, 1))
    addEntry(png(64, 64, 2))
    const r = await svc.restore(String(a))
    expect(r).toMatchObject({ ok: true, outcome: 'restored', verified: true })
    expect(stats.uploads).toBe(1)
    expect(h.stored()).toHaveLength(1)    // le 401 de la route n'a pas déconnecté l'utilisateur
  })

  it('restaurer le skin déjà actuel est un no-op', async () => {
    const { svc, addEntry, stats } = await setup()
    const a = addEntry(png(64, 64, 1))
    expect(await svc.restore(String(a))).toMatchObject({ ok: true, outcome: 'unchanged' })
    expect(stats.restores).toBe(0)
  })

  it('entrée inconnue : message compréhensible', async () => {
    const { svc } = await setup()
    expect(await svc.restore('999')).toEqual({ ok: false, error: 'Skin introuvable dans ton historique.' })
  })

  it("refuse d'annoncer un succès si le skin servi au jeu ne correspond pas", async () => {
    const { svc, addEntry, forceActive } = await setup('dedupe')
    const a = addEntry(png(64, 64, 1))
    addEntry(png(64, 64, 2))
    // Le serveur répond « ok » mais /skins/alice.png sert toujours un autre fichier.
    forceActive(png(64, 64, 99))
    const r = await svc.restore(String(a))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toContain('ne correspond pas')
  })

  it('erreur réseau : message clair, aucune déconnexion', async () => {
    const { svc, addEntry, h } = await setup()
    const a = addEntry(png(64, 64, 1))
    addEntry(png(64, 64, 2))
    h.server.state.offline = true
    const r = await svc.restore(String(a))
    expect(r).toMatchObject({ ok: false })
    expect(r.ok === false && r.error).toContain('injoignable')
    expect(h.stored()).toHaveLength(1)
  })
})
