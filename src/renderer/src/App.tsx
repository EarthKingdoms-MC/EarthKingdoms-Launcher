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

type AppState = 'loading' | 'updating' | 'login' | 'app'

export default function App() {
  const [appState,      setAppState]      = useState<AppState>('loading')
  const [account,       setAccount]       = useState<Account | null>(null)
  const [page,          setPage]          = useState<Page>('home')
  const [showSkinModal, setShowSkinModal] = useState(false)
  const [ram,           setRam]           = useState(4)

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
            : 'Vérification des mises à jour…'}
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
