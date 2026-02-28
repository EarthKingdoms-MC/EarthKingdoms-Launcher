import { useState, useEffect, Component, ErrorInfo, ReactNode } from 'react'
import Header        from './components/Header'
import Footer        from './components/Footer'
import SkinModal     from './components/SkinModal'
import LoginPage     from './pages/LoginPage'
import HomePage      from './pages/HomePage'
import SettingsPage  from './pages/SettingsPage'
import LogsPage      from './pages/LogsPage'
import ModsPage      from './pages/ModsPage'
import PatchNotesPage from './pages/PatchNotesPage'
import DynmapPage    from './pages/DynmapPage'
import ShopPage      from './pages/ShopPage'
import { Account }   from './hooks/useSkin'
import { playClick, playPlay, playClose, setSoundEnabled } from './utils/sounds'

// ── Error Boundary — attrape les crashes React et affiche un message lisible ─
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 12,
          background: 'var(--bg-main)', padding: 32,
        }}>
          <span style={{ fontSize: 28 }}>⚠️</span>
          <span style={{ fontSize: 14, color: 'var(--warning)', fontWeight: 600 }}>
            Une erreur inattendue s'est produite
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 480 }}>
            {this.state.error.message}
          </span>
          <button
            className="btn-secondary"
            style={{ marginTop: 8 }}
            onClick={() => this.setState({ error: null })}
          >
            Réessayer
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export type Page = 'home' | 'settings' | 'logs' | 'mods' | 'patchnotes' | 'dynmap' | 'shop'

type AppState = 'loading' | 'updating' | 'login' | 'app'

const LOADING_MSGS = [
  'Vérification des mises à jour…',
  'Connexion au serveur EarthKingdoms…',
  'Chargement des configurations…',
  'Initialisation du launcher…',
  'Récupération des données du jeu…',
]

export default function App() {
  const [appState,           setAppState]          = useState<AppState>('loading')
  const [account,            setAccount]           = useState<Account | null>(null)
  const [accounts,           setAccounts]          = useState<Array<{ username: string; uuid: string; isAdmin: boolean }>>([])
  const [page,               setPage]              = useState<Page>('home')
  const [showSkinModal,      setShowSkinModal]     = useState(false)
  const [showAddAccount,     setShowAddAccount]    = useState(false)
  const [skinRefreshKey,     setSkinRefreshKey]    = useState(0)
  const [ram,                setRam]               = useState(4)
  const [resW,               setResW]              = useState(854)
  const [resH,               setResH]              = useState(480)
  const [javaPath,           setJavaPath]          = useState<string | null>(null)
  const [loadingMsgIdx,      setLoadingMsgIdx]     = useState(0)
  const [newsBadge,          setNewsBadge]         = useState(0)
  const [lastNewsCount,      setLastNewsCount]     = useState(0)

  // Rotation des messages de chargement
  useEffect(() => {
    if (appState !== 'loading') return
    const iv = setInterval(() => setLoadingMsgIdx(i => (i + 1) % LOADING_MSGS.length), 2000)
    return () => clearInterval(iv)
  }, [appState])

  // Initialisation
  useEffect(() => {
    async function init() {
      try {
        const [{ available }] = await Promise.all([
          (window.api as any).updateCheck() as Promise<{ available: boolean }>,
          new Promise(r => setTimeout(r, 1500)),
        ])
        if (available) {
          setAppState('updating')
          return
        }

        const storedRam = await window.api.storeGet('ram')
        if (typeof storedRam === 'number') setRam(storedRam)

        const storedW = await window.api.storeGet('resolutionWidth')
        const storedH = await window.api.storeGet('resolutionHeight')
        if (typeof storedW === 'number') setResW(storedW)
        if (typeof storedH === 'number') setResH(storedH)

        const storedJava = await window.api.storeGet('javaPath')
        if (typeof storedJava === 'string') setJavaPath(storedJava)

        // Charger préférence sons
        const soundOn = await window.api.storeGet('soundEnabled')
        if (typeof soundOn === 'boolean') setSoundEnabled(soundOn)

        const acc = await window.api.authGetAccount()
        if (acc) {
          setAccount(acc)
          setAppState('app')
          refreshAccounts()
        } else {
          setAppState('login')
        }
      } catch {
        // En cas d'erreur inattendue, afficher la page de login plutôt que rester bloqué
        setAppState('login')
      }
    }
    init()
  }, [])

  // Badge news
  useEffect(() => {
    if (appState !== 'app') return
    async function checkNews() {
      try {
        const [html, lastSeen] = await Promise.all([
          window.api.newsLoad(),
          window.api.storeGet('lastSeenNewsCount'),
        ])
        if (!html) return
        const doc   = new DOMParser().parseFromString(html, 'text/html')
        const count = doc.querySelectorAll('.news-card, .card').length
        setLastNewsCount(count)
        const seen = typeof lastSeen === 'number' ? lastSeen : 0
        if (count > seen) setNewsBadge(count - seen)
      } catch { }
    }
    checkNews()
  }, [appState])

  // Son de fermeture MC
  useEffect(() => {
    if (appState !== 'app') return
    const onClose = () => playClose()
    window.api.on('launch:close', onClose as (a: unknown) => void)
    return () => window.api.off('launch:close', onClose as (a: unknown) => void)
  }, [appState])

  // Listener global sons sur tous les boutons
  useEffect(() => {
    if (appState !== 'app') return
    const handler = (e: MouseEvent) => {
      try {
        const btn = (e.target as Element).closest('button')
        if (!btn) return
        const sound = btn.getAttribute('data-sound')
        if (sound === 'play')  playPlay()
        else if (sound === 'close') playClose()
        else playClick()
      } catch { /* son désactivé silencieusement */ }
    }
    document.addEventListener('click', handler, true)
    return () => document.removeEventListener('click', handler, true)
  }, [appState])

  async function refreshAccounts() {
    try {
      const list = await window.api.authGetAccounts()
      setAccounts(list)
    } catch { }
  }

  function handleLogin(acc: Account) {
    setAccount(acc)
    setAppState('app')
    setShowAddAccount(false)
    refreshAccounts()
  }

  async function handleLogout() {
    await window.api.authLogout()
    setAccount(null)
    setAccounts([])
    setAppState('login')
  }

  async function handleSwitchAccount(uuid: string) {
    const result = await window.api.authSwitchAccount(uuid)
    if (result.ok && result.account) {
      setAccount(result.account)
      setSkinRefreshKey(k => k + 1)
    }
  }

  async function handleRemoveAccount(uuid: string) {
    const result = await window.api.authRemoveAccount(uuid)
    await refreshAccounts()
    if (result.nextAccount) {
      setAccount(result.nextAccount)
      setSkinRefreshKey(k => k + 1)
    } else if (!result.nextAccount) {
      // Plus aucun compte → page de login
      setAccount(null)
      setAppState('login')
    }
  }

  function handleNavigate(p: Page) {
    setPage(p)
    if (p === 'home' && newsBadge > 0) {
      setNewsBadge(0)
      window.api.storeSet('lastSeenNewsCount', lastNewsCount)
    }
  }

  async function handleSaveRam(v: number) {
    setRam(v)
    await window.api.storeSet('ram', v)
  }

  async function handleSaveRes(w: number, h: number) {
    setResW(w)
    setResH(h)
    await window.api.storeSet('resolutionWidth', w)
    await window.api.storeSet('resolutionHeight', h)
  }

  async function handleSaveJava(path: string | null) {
    setJavaPath(path)
    await window.api.storeSet('javaPath', path)
  }

  function handleSkinUploaded() {
    setSkinRefreshKey(k => k + 1)
  }

  // Écran de chargement initial
  if (appState === 'loading' || appState === 'updating') {
    return (
      <div style={{
        width: '100%', height: '100%',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 16, background: 'var(--bg-main)'
      }}>
        <img src="./logo32.png" style={{ width: 48, height: 48, imageRendering: 'pixelated', opacity: 0.8 }} alt="" />
        <span style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
          {appState === 'updating'
            ? <span style={{ color: 'var(--warning)' }}>Mise à jour en cours…</span>
            : LOADING_MSGS[loadingMsgIdx]}
        </span>
      </div>
    )
  }

  // Modal "Ajouter un compte" (overlay par-dessus l'app)
  if (showAddAccount) {
    return (
      <div className="app" style={{ position: 'relative' }}>
        <div style={{
          position: 'absolute', inset: 0, zIndex: 200,
          background: 'rgba(14,10,42,0.97)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ position: 'absolute', top: 16, right: 16 }}>
            <button
              className="btn-secondary"
              data-sound="close"
              onClick={() => setShowAddAccount(false)}
            >
              ✕ Annuler
            </button>
          </div>
          <LoginPage onLogin={handleLogin} />
        </div>
      </div>
    )
  }

  // Page de connexion principale
  if (appState === 'login') {
    return <LoginPage onLogin={handleLogin} />
  }

  return (
    <div className="app">
      <Header
        currentPage={page}
        onNavigate={handleNavigate}
        username={account!.username}
        skinRefreshKey={skinRefreshKey}
        onOpenSkin={() => setShowSkinModal(true)}
        onLogout={handleLogout}
        newsBadge={newsBadge}
        accounts={accounts}
        activeUuid={account!.uuid}
        onSwitchAccount={handleSwitchAccount}
        onAddAccount={() => setShowAddAccount(true)}
        onRemoveAccount={handleRemoveAccount}
      />

      <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <ErrorBoundary key={page}>
          {page === 'home'       && <HomePage />}
          {page === 'settings'   && (
            <SettingsPage
              savedRam={ram}      onSaveRam={handleSaveRam}
              savedResW={resW}    savedResH={resH}  onSaveRes={handleSaveRes}
              savedJavaPath={javaPath}              onSaveJava={handleSaveJava}
            />
          )}
          {page === 'logs'       && <LogsPage />}
          {page === 'mods'       && <ModsPage />}
          {page === 'patchnotes' && <PatchNotesPage />}
          {page === 'dynmap'     && <DynmapPage />}
          {page === 'shop'       && <ShopPage />}
        </ErrorBoundary>
      </main>

      <Footer ram={ram} />

      {showSkinModal && account && (
        <SkinModal
          username={account.username}
          skinRefreshKey={skinRefreshKey}
          onSkinUploaded={handleSkinUploaded}
          onClose={() => setShowSkinModal(false)}
        />
      )}
    </div>
  )
}
