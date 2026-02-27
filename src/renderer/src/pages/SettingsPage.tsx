import './SettingsPage.css'
import { useState, useRef, useEffect } from 'react'

function ramHint(ram: number): string {
  if (ram < 4)  return 'En dessous du minimum — risque de lag et de crash.'
  if (ram <= 6) return 'Optimal pour EarthKingdoms. Bonne marge pour le système.'
  if (ram <= 10) return 'Confortable. Utile si tu as des shaders actifs.'
  return 'Attention — laisse au moins 4 Go au système d\'exploitation.'
}

interface Props {
  savedRam:  number
  onSaveRam: (v: number) => void
}

export default function SettingsPage({ savedRam, onSaveRam }: Props) {
  const [ram,   setRam]   = useState(savedRam)
  const [saved, setSaved] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty    = ram !== savedRam

  // Sync quand savedRam change (ex: init async depuis electron-store)
  useEffect(() => { setRam(savedRam) }, [savedRam])

  // Nettoyage timer à la destruction
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
  const ramFill  = ((ram - 2) / 14) * 100

  function handleRamChange(v: number) {
    setRam(v)
    setSaved(false)
  }

  function handleSave() {
    onSaveRam(ram)
    setSaved(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="settings">
      <div className="settings__content">
        <div className="settings__page-label">Configuration</div>

        <section className="settings__section">
          <h2 className="settings__section-title">
            <img src="./icons/ram.svg" alt="" style={{ width: 16, height: 16, filter: 'invert(1)', opacity: 0.6 }} />
            Mémoire allouée
          </h2>
          <div className="settings__row settings__row--col">
            <div className="settings__row-top">
              <label>RAM pour Minecraft</label>
              <span className="settings__ram-value">{ram} <span>Go</span></span>
            </div>
            <input
              type="range" min={2} max={16} step={1}
              value={ram} onChange={e => handleRamChange(Number(e.target.value))}
              className="settings__slider"
              style={{ '--fill': `${ramFill}%` } as React.CSSProperties}
            />
            <span className={`settings__hint ${ram < 4 ? 'settings__hint--warn' : ''}`}>
              {ramHint(ram)}
            </span>
          </div>
        </section>

        <section className="settings__section">
          <h2 className="settings__section-title">
            <img src="./icons/java.svg" alt="" style={{ width: 16, height: 16, filter: 'invert(1)', opacity: 0.6 }} />
            Environnement Java
          </h2>
          <div className="settings__row">
            <label>Version active</label>
            <span className="settings__badge">Java 17 · Embarqué</span>
          </div>
          <div className="settings__row">
            <div>
              <label>Chemin personnalisé</label>
              <span className="settings__hint">Laisse vide pour utiliser le JRE intégré.</span>
            </div>
            <button className="btn-secondary">
              <img src="./icons/folder.svg" alt="" style={{ width: 13, height: 13, filter: 'invert(1)' }} />
              Parcourir
            </button>
          </div>
        </section>

        <section className="settings__section">
          <h2 className="settings__section-title">
            <img src="./icons/screen.svg" alt="" style={{ width: 16, height: 16, filter: 'invert(1)', opacity: 0.6 }} />
            Affichage
          </h2>
          <div className="settings__row">
            <label>Résolution au lancement</label>
            <span className="settings__badge">1920 × 1080</span>
          </div>
        </section>

        <div className="settings__save-bar">
          {saved && <span className="settings__save-confirm">✓ Paramètres sauvegardés</span>}
          <button
            className={`btn-secondary settings__save-btn ${dirty ? 'settings__save-btn--dirty' : ''}`}
            onClick={handleSave}
            disabled={!dirty}
          >
            Sauvegarder
          </button>
        </div>
      </div>
    </div>
  )
}
