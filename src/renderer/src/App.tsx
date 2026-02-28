import { useState, useEffect } from 'react'
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
import { Account }   from './hooks/useSkin'

export type Page = 'home' | 'settings' | 'logs' | 'mods' | 'patchnotes' | 'dynmap'

type AppState = 'loading' | 'updating' | 'login' | 'app'

const LOADING_MSGS = [
  'Vérification des mises à jour…',
  'Connexion au serveur EarthKingdoms…',
  'Chargement des configurations…',
  'Initialisation du launcher…',
  'Récupération des données du jeu…',
]

export default function App() {
  const [appState,       setAppState]      = useState<AppState>('loading')
  const [account,        setAccount]       = useState<Account | null>(null)
  const [page,           setPage]          = useState<Page>('home')
  const [showSkinModal,  setShowSkinModal] = useState(false)
  const [skinRefreshKey, setSkinRefreshKey] = useState(0)
  const [ram,            setRam]           = useState(4)
  const [resW,           setResW]          = useState(854)
  const [resH,           setResH]          = useState(480)
  const [javaPath,       setJavaPath]      = useState<string | null>(null)
  const [loadingMsgIdx,  setLoadingMsgIdx] = useState(0)
  const [newsBadge,      setNewsBadge]     = useState(0)
  const [lastNewsCount,  setLastNewsCount] = useState(0)

  // Rotation des messages de chargement (toutes les 2s)
  useEffect(() => {
    if (appState !== 'loading') return
    const iv = setInterval(() => setLoadingMsgIdx(i => (i + 1) % LOADING_MSGS.length), 2000)
    return () => clearInterval(iv)
  }, [appState])

  // Initialisation : vérifie d'abord les mises à jour, puis charge le compte
  useEffect(() => {
    async function init() {
      // 1. Vérification de mise à jour (bloquante, max 8s) — min 1.5s pour que l'écran soit visible
      const [{ available }] = await Promise.all([
        (window.api as any).updateCheck() as Promise<{ available: boolean }>,
        new Promise(r => setTimeout(r, 1500)),
      ])
      if (available) {
        setAppState('updating')
        return  // L'app redémarre automatiquement quand le téléchargement est terminé
      }

      // 2. Init normale
      const storedRam = await window.api.storeGet('ram')
      if (typeof storedRam === 'number') setRam(storedRam)

      const storedW = await window.api.storeGet('resolutionWidth')
      const storedH = await window.api.storeGet('resolutionHeight')
      if (typeof storedW === 'number') setResW(storedW)
      if (typeof storedH === 'number') setResH(storedH)

      const storedJava = await window.api.storeGet('javaPath')
      if (typeof storedJava === 'string') setJavaPath(storedJava)

      const acc = await window.api.authGetAccount()
      if (acc) {
        setAccount(acc)
        setAppState('app')
      } else {
        setAppState('login')
      }
    }
    init()
  }, [])

  // Vérification badge news après connexion
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
      } catch { /* silencieux */ }
    }
    checkNews()
  }, [appState])

  function handleLogin(acc: Account) {
    setAccount(acc)
    setAppState('app')
  }

  async function handleLogout() {
    await window.api.authLogout()
    setAccount(null)
    setAppState('login')
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
        <img
          src="./logo32.png"
          style={{ width: 48, height: 48, imageRendering: 'pixelated', opacity: 0.8 }}
          alt=""
        />
        <span style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
          {appState === 'updating'
            ? <span style={{ color: 'var(--warning)' }}>Mise à jour en cours…</span>
            : LOADING_MSGS[loadingMsgIdx]}
        </span>
      </div>
    )
  }

  // Page de connexion
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
      />

      <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
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
