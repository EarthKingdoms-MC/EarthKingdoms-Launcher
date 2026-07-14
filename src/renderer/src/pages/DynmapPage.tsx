import { useEffect, useRef, useState } from 'react'
import './DynmapPage.css'

// URL brute de la carte, sans le chrome du site (header/nav) - /dynmap redirige
// maintenant vers la page /livemap complète (avec nav), donc on pointe direct
// sur le fichier statique qu'elle embarque elle-même en iframe.
const DYNMAP_URL = 'https://earthkingdoms-mc.fr/livemap/index.html'

// Déclaration du type Electron webview pour TypeScript
declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        allowpopups?: string
        useragent?: string
      }
    }
  }
}

export default function DynmapPage() {
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)
  const webviewRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = webviewRef.current
    if (!el) return

    const onFinish  = () => { setLoading(false); setError(false) }
    const onFail    = (_e: Event) => {
      // did-fail-load se déclenche aussi sur les erreurs -3 (aborted) lors des redirections
      // On ignore ces cas pour ne pas afficher d'erreur inutile
      const detail = (_e as CustomEvent).detail
      if (detail?.errorCode === -3) return
      setLoading(false)
      setError(true)
    }

    el.addEventListener('did-finish-load', onFinish)
    el.addEventListener('did-fail-load',   onFail)
    return () => {
      el.removeEventListener('did-finish-load', onFinish)
      el.removeEventListener('did-fail-load',   onFail)
    }
  }, [])

  function handleReload() {
    const el = webviewRef.current as any
    if (el?.reload) el.reload()
    setError(false)
    setLoading(true)
  }

  return (
    <div className="dynmap">
      {/* Overlay de chargement */}
      {loading && !error && (
        <div className="dynmap__overlay">
          <div className="dynmap__overlay-icon">◈</div>
          <span className="dynmap__overlay-text">Chargement de la Livemap…</span>
        </div>
      )}

      {/* Erreur réseau */}
      {error && (
        <div className="dynmap__overlay">
          <div className="dynmap__overlay-icon dynmap__overlay-icon--warn">⚠</div>
          <div className="dynmap__overlay-title">Livemap indisponible</div>
          <div className="dynmap__overlay-sub">
            Impossible de charger la carte. Vérifie ta connexion.
          </div>
          <button className="btn-secondary" onClick={handleReload} style={{ marginTop: 8 }}>
            Réessayer
          </button>
        </div>
      )}

      {/* webview Electron - plein écran */}
      <webview
        ref={webviewRef}
        src={DYNMAP_URL}
        className={`dynmap__webview${error ? ' dynmap__webview--hidden' : ''}`}
      />
    </div>
  )
}
