import { useState } from 'react'
import { Page } from '../App'
import { useSkinHead } from '../hooks/useSkin'
import {
    User, Image as ImageIcon, UserPlus, LogOut, ChevronDown, Minus, Square, X,
    House, FileText, Map as MapIcon, RefreshCw, ShoppingBag, Terminal, Settings, type LucideIcon,
} from 'lucide-react'
import './Header.css'

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
    overrideHeadUrl?: string | null
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
                                   currentPage, onNavigate, username, skinRefreshKey, overrideHeadUrl, onOpenSkin, onLogout,
                                   newsBadge, accounts = [], activeUuid, onSwitchAccount, onAddAccount, onRemoveAccount,
                               }: Props) {
    const fetchedHeadUrl = useSkinHead(username, skinRefreshKey)
    const headUrl = overrideHeadUrl ?? fetchedHeadUrl
    const [showAccountMenu, setShowAccountMenu] = useState(false)

    const navItems: { id: Page; icon: LucideIcon; label: string; badge: number }[] = [
        { id: 'home',       icon: House,       label: 'Accueil',     badge: newsBadge ?? 0 },
        { id: 'patchnotes', icon: FileText,    label: 'Patch Notes', badge: 0 },
        { id: 'livemap',    icon: MapIcon,     label: 'Livemap',     badge: 0 },
        { id: 'mods',       icon: RefreshCw,   label: 'Mods',        badge: 0 },
        { id: 'shop',       icon: ShoppingBag, label: 'Boutique',    badge: 0 },
        { id: 'logs',       icon: Terminal,    label: 'Logs',        badge: 0 },
    ]

    function handleProfileClick() {
        setShowAccountMenu(v => !v)
    }

    function closeMenu() {
        setShowAccountMenu(false)
    }

    return (
        <header className="header">
            {/* Logo */}
            <div className="header__drag">
                <div className="header__logo">
                    <img
                        src="./logos/logo-36.png"
                        srcSet="./logos/logo-72.png 2x, ./logos/logo-108.png 3x"
                        alt="EarthKingdoms"
                        className="header__logo-img"
                    />
                </div>
            </div>

            {/* Navigation */}
            <nav className="header__nav">
                {navItems.map(({ id, icon: Icon, label, badge }) => (
                    <button
                        key={id}
                        className={`header__nav-btn ${currentPage === id ? 'active' : ''}`}
                        onClick={() => onNavigate(id)}
                    >
                        <Icon size={15} strokeWidth={2} />
                        {label}
                        {badge > 0 && (
                            <span className="header__nav-badge">{badge > 9 ? '9+' : badge}</span>
                        )}
                    </button>
                ))}
            </nav>

            {/* Profil + tête skin */}
            <div className="header__actions">
                <button
                    className={`header__settings ${currentPage === 'settings' ? 'active' : ''}`}
                    onClick={() => onNavigate('settings')}
                    title="Paramètres"
                >
                    <Settings size={16} strokeWidth={2} />
                </button>
                <div className="header__profile-wrap">
                    <button
                        className={`header__profile ${showAccountMenu ? 'open' : ''}`}
                        onClick={handleProfileClick}
                        title="Mon compte"
                    >
                        {headUrl
                            ? <img src={headUrl} className="header__avatar" alt="head" />
                            : <User className="header__avatar header__avatar--fallback" size={12} strokeWidth={2} />
                        }
                        <span className="header__username">{username}</span>
                        <ChevronDown className="header__profile-chevron" size={16} strokeWidth={2} />
                    </button>

                    {showAccountMenu && (
                        <>
                            <div className="header__account-backdrop" onClick={closeMenu} />
                            <div className="header__account-menu">
                                <div className="header__account-current">
                                    {headUrl
                                        ? <img src={headUrl} className="header__account-current-avatar" alt="head" />
                                        : <User className="header__account-current-avatar header__avatar--fallback" size={12} strokeWidth={2} />
                                    }
                                    <div className="header__account-current-info">
                                        <span className="header__account-current-name">{username}</span>
                                        {accounts.find(a => a.uuid === activeUuid)?.isAdmin && (
                                            <span className="header__account-admin">ADMIN</span>
                                        )}
                                    </div>
                                </div>

                                <div className="header__account-menu-sep" />

                                <button className="header__account-action" onClick={() => { onNavigate('playerstatus'); closeMenu() }}>
                                    <User size={15} strokeWidth={2} />
                                    Mon profil
                                </button>
                                <button className="header__account-action" onClick={() => { onOpenSkin(); closeMenu() }}>
                                    <ImageIcon size={15} strokeWidth={2} />
                                    Gérer le skin
                                </button>

                                {accounts.length > 1 && (
                                    <>
                                        <div className="header__account-menu-sep" />
                                        <div className="header__account-menu-title">Comptes</div>
                                        {accounts.filter(acc => acc.uuid !== activeUuid).map(acc => (
                                            <div key={acc.uuid} className="header__account-item">
                                                <button
                                                    className="header__account-switch"
                                                    onClick={() => { onSwitchAccount?.(acc.uuid); closeMenu() }}
                                                >
                                                    <span className="header__account-dot" />
                                                    <span>{acc.username}</span>
                                                    {!!acc.isAdmin && <span className="header__account-admin">ADMIN</span>}
                                                </button>
                                                <button
                                                    className="header__account-remove"
                                                    data-sound="close"
                                                    title="Retirer ce compte"
                                                    onClick={() => { onRemoveAccount?.(acc.uuid); closeMenu() }}
                                                ><X size={12} strokeWidth={2} /></button>
                                            </div>
                                        ))}
                                    </>
                                )}

                                <div className="header__account-menu-sep" />
                                {onAddAccount && (
                                    <button className="header__account-action" onClick={() => { onAddAccount(); closeMenu() }}>
                                        <UserPlus size={15} strokeWidth={2} />
                                        Ajouter un compte
                                    </button>
                                )}
                                {onLogout && (
                                    <button
                                        className="header__account-action header__account-action--danger"
                                        data-sound="close"
                                        onClick={() => { onLogout(); closeMenu() }}
                                    >
                                        <LogOut size={15} strokeWidth={2} />
                                        Déconnecter {username}
                                    </button>
                                )}
                            </div>
                        </>
                    )}
                </div>

                <div className="header__window-controls">
                    <button onClick={() => window.api.minimize()} title="Réduire">
                        <Minus size={18} strokeWidth={2} />
                    </button>

                    <button onClick={() => window.api.maximize()} title="Agrandir">
                        <Square size={14} strokeWidth={2} />
                    </button>

                    <button className="close" onClick={() => window.api.close()} title="Fermer">
                        <X size={20} strokeWidth={2} />
                    </button>
                </div>
            </div>
        </header>
    )
}
