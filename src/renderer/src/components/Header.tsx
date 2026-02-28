import { useState } from 'react'
import { Page } from '../App'
import { useSkinHead } from '../hooks/useSkin'
import './Header.css'

declare global {
  interface Window { api: { minimize(): void; maximize(): void; close(): void } }
}

interface AccountInfo {
  username: string
  uuid:     string
  isAdmin:  boolean
}

interface Props {
  currentPage:      Page
  onNavigate:       (p: Page) => void
  username:         string
  skinRefreshKey?:  number
  onOpenSkin:       () => void
  onLogout?:        () => void
  newsBadge?:       number
  accounts?:        AccountInfo[]
  activeUuid?:      string
  onSwitchAccount?: (uuid: string) => void
  onAddAccount?:    () => void
  onRemoveAccount?: (uuid: string) => void
}

export default function Header({
  currentPage, onNavigate, username, skinRefreshKey, onOpenSkin, onLogout,
  newsBadge, accounts = [], activeUuid, onSwitchAccount, onAddAccount, onRemoveAccount,
}: Props) {
  const headUrl = useSkinHead(username, skinRefreshKey)
  const [showAccountMenu, setShowAccountMenu] = useState(false)

  const navItems = [
    { id: 'home',       icon: './icons/home.svg',     label: 'Accueil',     badge: newsBadge ?? 0 },
    { id: 'mods',       icon: './icons/update.svg',   label: 'Mods',        badge: 0 },
    { id: 'patchnotes', icon: './icons/news.svg',     label: 'Patch Notes', badge: 0 },
    { id: 'dynmap',     icon: './icons/map.svg',      label: 'Dynmap',      badge: 0 },
    { id: 'shop',       icon: './icons/shop.svg',     label: 'Boutique',    badge: 0 },
    { id: 'settings',   icon: './icons/settings.svg', label: 'Paramètres',  badge: 0 },
    { id: 'logs',       icon: './icons/logs.svg',     label: 'Logs',        badge: 0 },
  ] as { id: Page; icon: string; label: string; badge: number }[]

  function handleProfileClick() {
    if (accounts.length > 1 || onAddAccount) {
      setShowAccountMenu(v => !v)
    } else {
      onOpenSkin()
    }
  }

  function closeMenu() {
    setShowAccountMenu(false)
  }

  return (
    <header className="header">
      {/* Logo */}
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
        {navItems.map(({ id, icon, label, badge }) => (
          <button
            key={id}
            className={`header__nav-btn ${currentPage === id ? 'active' : ''}`}
            onClick={() => onNavigate(id)}
          >
            <img src={icon} alt="" />
            {label}
            {badge > 0 && (
              <span className="header__nav-badge">{badge > 9 ? '9+' : badge}</span>
            )}
          </button>
        ))}
      </nav>

      {/* Profil + tête skin */}
      <div className="header__actions">
        <div className="header__profile-wrap">
          <button
            className="header__profile"
            onClick={handleProfileClick}
            title={accounts.length > 1 ? 'Gérer les comptes' : 'Gérer le skin'}
          >
            {headUrl
              ? <img src={headUrl} className="header__avatar" alt="head" />
              : <img src="./icons/avatar-default.svg" className="header__avatar header__avatar--fallback" alt="avatar" />
            }
            <span className="header__username">{username}</span>
            {(accounts.length > 1 || onAddAccount) && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 2, opacity: 0.5 }}>
                <path d="M7 10l5 5 5-5z"/>
              </svg>
            )}
          </button>

          {showAccountMenu && (
            <>
              <div className="header__account-backdrop" onClick={closeMenu} />
              <div className="header__account-menu">
                <div className="header__account-menu-title">Comptes</div>
                {accounts.map(acc => (
                  <div key={acc.uuid} className={`header__account-item${acc.uuid === activeUuid ? ' header__account-item--active' : ''}`}>
                    <button
                      className="header__account-switch"
                      onClick={() => { onSwitchAccount?.(acc.uuid); closeMenu() }}
                      disabled={acc.uuid === activeUuid}
                    >
                      <span className="header__account-dot" />
                      <span>{acc.username}</span>
                      {!!acc.isAdmin && <span className="header__account-admin">ADMIN</span>}
                    </button>
                    {acc.uuid !== activeUuid && (
                      <button
                        className="header__account-remove"
                        data-sound="close"
                        title="Retirer ce compte"
                        onClick={() => { onRemoveAccount?.(acc.uuid); closeMenu() }}
                      >✕</button>
                    )}
                  </div>
                ))}
                <div className="header__account-menu-sep" />
                <button className="header__account-action" onClick={() => { onOpenSkin(); closeMenu() }}>
                  Gérer le skin
                </button>
                {onAddAccount && (
                  <button className="header__account-action" onClick={() => { onAddAccount(); closeMenu() }}>
                    + Ajouter un compte
                  </button>
                )}
                {onLogout && (
                  <button
                    className="header__account-action header__account-action--danger"
                    data-sound="close"
                    onClick={() => { onLogout(); closeMenu() }}
                  >
                    Déconnecter {username}
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Bouton logout direct si pas de menu multicompte */}
        {onLogout && accounts.length <= 1 && (
          <button className="header__logout" data-sound="close" onClick={onLogout} title="Se déconnecter">
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
