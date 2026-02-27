import { useState, useEffect } from 'react'
import Header      from './components/Header'
import Footer      from './components/Footer'
import SkinModal   from './components/SkinModal'
import LoginPage   from './pages/LoginPage'
import HomePage    from './pages/HomePage'
import SettingsPage from './pages/SettingsPage'
import LogsPage    from './pages/LogsPage'
import ModsPage    from './pages/ModsPage'
import { Account } from './hooks/useSkin'

export type Page = 'home' | 'settings' | 'logs' | 'mods'

type AppState = 'loading' | 'login' | 'app'

export default function App() {
  const [appState,      setAppState]      = useState<AppState>('loading')
  const [account,       setAccount]       = useState<Account | null>(null)
  const [page,          setPage]          = useState<Page>('home')
  const [showSkinModal, setShowSkinModal] = useState(false)
  const [ram,           setRam]           = useState(4)

  // Initialisation : récupère le compte persisté + la RAM depuis electron-store
  useEffect(() => {
    async function init() {
      const storedRam = await window.api.storeGet('ram')
      if (typeof storedRam === 'number') setRam(storedRam)

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

  function handleLogin(acc: Account) {
    setAccount(acc)
    setAppState('app')
  }

  async function handleLogout() {
    await window.api.authLogout()
    setAccount(null)
    setAppState('login')
  }

  async function handleSaveRam(v: number) {
    setRam(v)
    await window.api.storeSet('ram', v)
  }

  // Écran de chargement initial
  if (appState === 'loading') {
    return (
      <div style={{
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-main)'
      }}>
        <img
          src="./logo32.png"
          style={{ width: 48, height: 48, imageRendering: 'pixelated', opacity: 0.5 }}
          alt=""
        />
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
        onNavigate={setPage}
        username={account!.username}
        onOpenSkin={() => setShowSkinModal(true)}
        onLogout={handleLogout}
      />

      <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {page === 'home'     && <HomePage />}
        {page === 'settings' && <SettingsPage savedRam={ram} onSaveRam={handleSaveRam} />}
        {page === 'logs'     && <LogsPage />}
        {page === 'mods'     && <ModsPage />}
      </main>

      <Footer ram={ram} />

      {showSkinModal && account && (
        <SkinModal username={account.username} onClose={() => setShowSkinModal(false)} />
      )}
    </div>
  )
}
