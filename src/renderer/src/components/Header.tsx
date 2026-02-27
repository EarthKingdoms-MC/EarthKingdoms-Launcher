import { Page } from '../App'
import { useSkinHead } from '../hooks/useSkin'
import './Header.css'

declare global {
  interface Window { api: { minimize(): void; maximize(): void; close(): void } }
}

interface Props {
  currentPage: Page
  onNavigate:  (p: Page) => void
  username:    string
  onOpenSkin:  () => void
  onLogout?:   () => void
}

export default function Header({ currentPage, onNavigate, username, onOpenSkin, onLogout }: Props) {
  const headUrl = useSkinHead(username)

  return (
    <header className="header">
      {/* Logo — zone draggable */}
      <div className="header__drag">
        <div className="header__logo">
          <img src="./logo32.png" alt="EarthKingdoms" className="header__logo-img" />
          <div className="header__logo-text">
            <span className="header__logo-earth">EARTH</span>
            <span className="header__logo-kingdoms">KINGDOMS</span>
            <span className="header__logo-mc font-mc">1.20.1</span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="header__nav">
        {([
          { id: 'home',     icon: './icons/home.svg',     label: 'Accueil'    },
          { id: 'mods',     icon: './icons/update.svg',   label: 'Mods'       },
          { id: 'settings', icon: './icons/settings.svg', label: 'Paramètres' },
          { id: 'logs',     icon: './icons/logs.svg',     label: 'Logs'       },
        ] as { id: Page; icon: string; label: string }[]).map(({ id, icon, label }) => (
          <button
            key={id}
            className={`header__nav-btn ${currentPage === id ? 'active' : ''}`}
            onClick={() => onNavigate(id)}
          >
            <img src={icon} alt="" />
            {label}
          </button>
        ))}
      </nav>

      {/* Profil + tête skin */}
      <div className="header__actions">
        <button className="header__profile" onClick={onOpenSkin} title="Gérer le skin">
          {headUrl
            ? <img src={headUrl} className="header__avatar" alt="head" />
            : <img src="./icons/avatar-default.svg" className="header__avatar header__avatar--fallback" alt="avatar" />
          }
          <span className="header__username">{username}</span>
        </button>

        {onLogout && (
          <button className="header__logout" onClick={onLogout} title="Se déconnecter">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        )}

        <div className="header__window-controls">
          <button onClick={() => window.api.minimize()} title="Réduire">─</button>
          <button onClick={() => window.api.maximize()} title="Agrandir">□</button>
          <button className="close" onClick={() => window.api.close()} title="Fermer">✕</button>
        </div>
      </div>
    </header>
  )
}
