import { useEffect, useState } from 'react'
import './Footer.css'

const LINKS = [
  {
    id: 'site',
    label: 'Site',
    url: 'https://earthkingdoms-mc.fr',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9"/>
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z"/>
      </svg>
    ),
  },
  {
    id: 'dynmap',
    label: 'Dynmap',
    url: 'https://map.earthkingdoms-mc.fr',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="3,6 9,3 15,6 21,3 21,18 15,21 9,18 3,21"/>
        <line x1="9" y1="3" x2="9" y2="18"/>
        <line x1="15" y1="6" x2="15" y2="21"/>
      </svg>
    ),
  },
  {
    id: 'wiki',
    label: 'Wiki',
    url: 'https://wiki.earthkingdoms-mc.fr',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        <line x1="9" y1="7" x2="15" y2="7"/>
        <line x1="9" y1="11" x2="13" y2="11"/>
      </svg>
    ),
  },
  {
    id: 'discord',
    label: 'Discord',
    url: 'https://discord.gg/6dyExsvwfC',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
      </svg>
    ),
  },
  {
    id: 'twitter',
    label: 'Twitter / X',
    url: 'https://twitter.com/earthkingdomsmc',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.259 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/>
      </svg>
    ),
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    url: 'https://tiktok.com/@earthkingdomsmc',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z"/>
      </svg>
    ),
  },
  {
    id: 'instagram',
    label: 'Instagram',
    url: 'https://instagram.com/earthkingdomsmc',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="5"/>
        <circle cx="12" cy="12" r="4.5"/>
        <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" stroke="none"/>
      </svg>
    ),
  },
  {
    id: 'youtube',
    label: 'YouTube',
    url: 'https://youtube.com/@earthkingdoms',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>
    ),
  },
]

// Séparateurs visuels entre groupes
const GROUPS = [
  ['site', 'dynmap', 'wiki'],
  ['discord', 'twitter', 'tiktok', 'instagram', 'youtube'],
]

interface Props {
  ram: number
}

export default function Footer({ ram }: Props) {
  const open = (url: string) => window.api.openExternal(url)
  const [version, setVersion] = useState('...')

  useEffect(() => {
    ;(window.api as any).appVersion().then((v: string) => setVersion(v))
  }, [])

  return (
    <footer className="footer">
      <span className="footer__item font-mc footer__item--ver">v{version}</span>
      <span className="footer__sep">·</span>
      <span className="footer__item">MC <span className="footer__value font-mc">1.20.1</span></span>
      <span className="footer__sep">·</span>
      <span className="footer__item">Forge <span className="footer__value font-mc">47.2.0</span></span>
      <span className="footer__sep">·</span>
      <span className="footer__item">Java <span className="footer__value font-mc">17</span></span>

      {/* Liens — centrés */}
      <div className="footer__links">
        {GROUPS.map((group, gi) => (
          <span key={gi} className="footer__link-group">
            {gi > 0 && <span className="footer__links-sep" />}
            {group.map(id => {
              const link = LINKS.find(l => l.id === id)!
              return (
                <button
                  key={id}
                  className="footer__link"
                  onClick={() => open(link.url)}
                  title={link.label}
                >
                  {link.icon}
                </button>
              )
            })}
          </span>
        ))}
      </div>

      <div className="footer__right">
        <span className="footer__server">SRV-EU</span>
        <span className="footer__sep">·</span>
        <span className="footer__item"><span className="footer__value font-mc">{ram}</span> Go alloués</span>
      </div>
    </footer>
  )
}
