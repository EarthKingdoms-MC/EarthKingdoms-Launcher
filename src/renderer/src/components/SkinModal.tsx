import { useState } from 'react'
import { useSkinHead, useSkinTexture, getSkinUrl } from '../hooks/useSkin'
import './SkinModal.css'

interface Props { username: string; onClose: () => void }

export default function SkinModal({ username, onClose }: Props) {
  const [tab, setTab] = useState<'apercu' | 'changer'>('apercu')
  const headUrl    = useSkinHead(username)
  const textureUrl = useSkinTexture(username)
  const skinUrl    = getSkinUrl(username)

  return (
    <div className="skinm__overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="skinm">

        {/* Header modal */}
        <div className="skinm__head">
          <div className="skinm__head-left">
            {headUrl
              ? <img src={headUrl} className="skinm__head-icon" alt="head" />
              : <div className="skinm__head-icon skinm__head-icon--fallback" />
            }
            <div>
              <div className="skinm__head-name">{username}</div>
              <div className="skinm__head-sub">Skin EarthKingdoms</div>
            </div>
          </div>
          <button className="skinm__close" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div className="skinm__tabs">
          <button className={tab === 'apercu'  ? 'active' : ''} onClick={() => setTab('apercu')}>Aperçu</button>
          <button className={tab === 'changer' ? 'active' : ''} onClick={() => setTab('changer')}>Changer le skin</button>
        </div>

        {/* Onglet aperçu */}
        {tab === 'apercu' && (
          <div className="skinm__preview">
            <div className="skinm__skin-frame">
              {textureUrl
                ? <img src={textureUrl} alt="Skin texture" className="skinm__skin-texture" />
                : <div className="skinm__skin-texture skinm__skin-texture--loading" />
              }
              <span className="skinm__skin-label">Texture brute</span>
            </div>

            <div className="skinm__skin-info">
              <div className="skinm__info-row">
                <span className="skinm__info-key">Joueur</span>
                <span className="skinm__info-val">{username}</span>
              </div>
              <div className="skinm__info-row">
                <span className="skinm__info-key">Source</span>
                <span className="skinm__info-val skinm__info-url">{skinUrl}</span>
              </div>
              <div className="skinm__info-row">
                <span className="skinm__info-key">Modèle</span>
                <span className="skinm__info-val">Steve (classique)</span>
              </div>
              <div className="skinm__3d-placeholder">
                <div className="skinm__3d-icon">◈</div>
                <span>Aperçu 3D — bientôt disponible</span>
              </div>
            </div>
          </div>
        )}

        {/* Onglet changer */}
        {tab === 'changer' && (
          <div className="skinm__change">
            <p className="skinm__change-notice">
              <span className="skinm__notice-icon">⚡</span>
              Les skins sont gérés par le serveur EarthKingdoms. La modification sera disponible dans une prochaine mise à jour du launcher.
            </p>

            <div className="skinm__field">
              <label>URL du skin (lecture seule)</label>
              <input type="text" value={skinUrl} readOnly className="skinm__input skinm__input--readonly" />
            </div>

            <div className="skinm__field">
              <label>Modèle</label>
              <div className="skinm__model-row">
                <button className="skinm__model-btn skinm__model-btn--active">Steve</button>
                <button className="skinm__model-btn" disabled>Alex — bientôt</button>
              </div>
            </div>

            <div className="skinm__upload-zone">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <span>Glisser un fichier .png ici</span>
              <span className="skinm__upload-sub">Bientôt disponible</span>
            </div>

            <button className="btn-play" disabled style={{ maxWidth: '100%', height: 48, fontSize: 16, letterSpacing: 3 }}>
              Appliquer le skin
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
