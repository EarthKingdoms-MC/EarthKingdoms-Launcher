import './SettingsPage.css'
import { useState, useRef, useEffect } from 'react'
import type { LaunchProfile } from '../hooks/useSkin'

function ramHint(ram: number): string {
  if (ram < 4)  return 'En dessous du minimum — risque de lag et de crash.'
  if (ram <= 6) return 'Optimal pour EarthKingdoms. Bonne marge pour le système.'
  if (ram <= 10) return 'Confortable. Utile si tu as des shaders actifs.'
  return 'Attention — laisse au moins 4 Go au système d\'exploitation.'
}

const RES_PRESETS = [
  { label: '854 × 480',   w: 854,  h: 480  },
  { label: '1280 × 720',  w: 1280, h: 720  },
  { label: '1920 × 1080', w: 1920, h: 1080 },
  { label: 'Personnalisé', w: 0,   h: 0    },
]

function getPresetIndex(w: number, h: number): number {
  const idx = RES_PRESETS.findIndex(p => p.w === w && p.h === h)
  return idx >= 0 ? idx : 3
}

function javaLabel(javaPath: string | null): string {
  if (!javaPath) return 'Java 17 · Embarqué'
  const parts = javaPath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || javaPath
}

interface Props {
  savedRam:      number
  onSaveRam:     (v: number) => void
  savedResW:     number
  savedResH:     number
  onSaveRes:     (w: number, h: number) => void
  savedJavaPath: string | null
  onSaveJava:    (path: string | null) => void
}

export default function SettingsPage({
  savedRam, onSaveRam,
  savedResW, savedResH, onSaveRes,
  savedJavaPath, onSaveJava,
}: Props) {
  const [ram,             setRam]             = useState(savedRam)
  const [resPreset,       setResPreset]       = useState(() => getPresetIndex(savedResW, savedResH))
  const [resW,            setResW]            = useState(savedResW)
  const [resH,            setResH]            = useState(savedResH)
  const [javaPath,        setJavaPath]        = useState<string | null>(savedJavaPath)
  const [saved,           setSaved]           = useState(false)
  const [totalRam,        setTotalRam]        = useState<number | null>(null)
  const [profiles,        setProfiles]        = useState<LaunchProfile[]>([])
  const [activeProfileId, setActiveProfileId] = useState('default')
  const [newProfileName,  setNewProfileName]  = useState('')
  const [showNewProfile,  setShowNewProfile]  = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dirty =
    ram !== savedRam ||
    resW !== savedResW || resH !== savedResH ||
    javaPath !== savedJavaPath

  // Sync quand les props changent (init async depuis electron-store)
  useEffect(() => { setRam(savedRam) }, [savedRam])
  useEffect(() => {
    setResW(savedResW)
    setResH(savedResH)
    setResPreset(getPresetIndex(savedResW, savedResH))
  }, [savedResW, savedResH])
  useEffect(() => { setJavaPath(savedJavaPath) }, [savedJavaPath])

  // Nettoyage timer à la destruction
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  // Charge la RAM système et les profils au montage
  useEffect(() => {
    window.api.systemTotalRam().then(v => setTotalRam(v)).catch(() => {})
    loadProfiles()
  }, [])

  const recommendedRam = totalRam
    ? Math.min(16, Math.max(4, Math.round(totalRam * 0.25)))
    : null

  async function loadProfiles() {
    try {
      const result = await window.api.profilesList()
      setProfiles(result.profiles)
      setActiveProfileId(result.activeId)
    } catch { /* silencieux */ }
  }

  async function handleProfileChange(id: string) {
    const profile = profiles.find(p => p.id === id)
    if (!profile) return
    setActiveProfileId(id)
    await window.api.profilesSetActive(id)
    setRam(profile.ram)
    setResW(profile.resW)
    setResH(profile.resH)
    setJavaPath(profile.javaPath)
    setResPreset(getPresetIndex(profile.resW, profile.resH))
    setSaved(false)
  }

  async function handleNewProfile() {
    if (!newProfileName.trim()) return
    const profile: LaunchProfile = {
      id:       `profile-${Date.now()}`,
      name:     newProfileName.trim(),
      ram, resW, resH, javaPath,
    }
    await window.api.profilesSave(profile)
    await window.api.profilesSetActive(profile.id)
    setActiveProfileId(profile.id)
    setNewProfileName('')
    setShowNewProfile(false)
    await loadProfiles()
  }

  async function handleDeleteProfile() {
    if (activeProfileId === 'default') return
    await window.api.profilesDelete(activeProfileId)
    const remaining = profiles.filter(p => p.id !== activeProfileId)
    setProfiles(remaining)
    setActiveProfileId('default')
    const def = remaining.find(p => p.id === 'default')
    if (def) {
      setRam(def.ram)
      setResW(def.resW)
      setResH(def.resH)
      setJavaPath(def.javaPath)
      setResPreset(getPresetIndex(def.resW, def.resH))
    }
  }

  const ramFill = ((ram - 2) / 14) * 100

  function handleRamChange(v: number) {
    setRam(v)
    setSaved(false)
  }

  function handlePresetChange(idx: number) {
    setResPreset(idx)
    if (idx < 3) {
      setResW(RES_PRESETS[idx].w)
      setResH(RES_PRESETS[idx].h)
    }
    setSaved(false)
  }

  function handleResWChange(v: number) {
    setResW(v)
    setResPreset(3)
    setSaved(false)
  }

  function handleResHChange(v: number) {
    setResH(v)
    setResPreset(3)
    setSaved(false)
  }

  async function handleBrowseJava() {
    const path = await (window.api as any).dialogOpenFile()
    if (path) {
      setJavaPath(path)
      setSaved(false)
    }
  }

  function handleResetJava() {
    setJavaPath(null)
    setSaved(false)
  }

  async function handleSave() {
    onSaveRam(ram)
    onSaveRes(resW, resH)
    onSaveJava(javaPath)
    // Met aussi à jour le profil actif
    const profile = profiles.find(p => p.id === activeProfileId)
    if (profile) {
      await window.api.profilesSave({ ...profile, ram, resW, resH, javaPath })
    }
    setSaved(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="settings">
      <div className="settings__content">
        <div className="settings__page-label">Configuration</div>

        {/* ── Profils ──────────────────────────────────────── */}
        <section className="settings__section">
          <h2 className="settings__section-title">
            <img src="./icons/settings.svg" alt="" style={{ width: 16, height: 16, filter: 'invert(1)', opacity: 0.6 }} />
            Profils de lancement
          </h2>
          <div className="settings__row">
            <label>Profil actif</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                className="settings__profile-select"
                value={activeProfileId}
                onChange={e => handleProfileChange(e.target.value)}
              >
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {activeProfileId !== 'default' && (
                <button className="btn-secondary" onClick={handleDeleteProfile}>Supprimer</button>
              )}
              {!showNewProfile && (
                <button className="btn-secondary" onClick={() => setShowNewProfile(true)}>+ Nouveau</button>
              )}
            </div>
          </div>
          {showNewProfile && (
            <div className="settings__row settings__profile-new">
              <input
                className="settings__profile-input"
                placeholder="Nom du profil…"
                value={newProfileName}
                onChange={e => setNewProfileName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter')  handleNewProfile()
                  if (e.key === 'Escape') { setShowNewProfile(false); setNewProfileName('') }
                }}
                autoFocus
              />
              <button className="btn-secondary" onClick={handleNewProfile} disabled={!newProfileName.trim()}>Créer</button>
              <button className="btn-secondary" onClick={() => { setShowNewProfile(false); setNewProfileName('') }}>Annuler</button>
            </div>
          )}
          <span className="settings__hint" style={{ padding: '2px 16px 0' }}>
            Sauvegarde différentes configurations (RAM, résolution, Java).
          </span>
        </section>

        {/* ── RAM ─────────────────────────────────────────── */}
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
            {recommendedRam !== null && (
              <span className="settings__hint settings__hint--rec">
                Machine : {totalRam} Go · Recommandé : <strong>{recommendedRam} Go</strong>
              </span>
            )}
          </div>
        </section>

        {/* ── Java ────────────────────────────────────────── */}
        <section className="settings__section">
          <h2 className="settings__section-title">
            <img src="./icons/java.svg" alt="" style={{ width: 16, height: 16, filter: 'invert(1)', opacity: 0.6 }} />
            Environnement Java
          </h2>
          <div className="settings__row">
            <label>Version active</label>
            <span className="settings__badge" title={javaPath ?? undefined}>{javaLabel(javaPath)}</span>
          </div>
          <div className="settings__row">
            <div>
              <label>Chemin personnalisé</label>
              <span className="settings__hint">
                {javaPath
                  ? <span style={{ color: 'var(--text)', wordBreak: 'break-all' }}>{javaPath}</span>
                  : 'Laisse vide pour utiliser le JRE intégré.'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {javaPath && (
                <button className="btn-secondary" onClick={handleResetJava} title="Utiliser le JRE intégré">
                  Réinitialiser
                </button>
              )}
              <button className="btn-secondary" onClick={handleBrowseJava}>
                <img src="./icons/folder.svg" alt="" style={{ width: 13, height: 13, filter: 'invert(1)' }} />
                Parcourir
              </button>
            </div>
          </div>
        </section>

        {/* ── Résolution ──────────────────────────────────── */}
        <section className="settings__section">
          <h2 className="settings__section-title">
            <img src="./icons/screen.svg" alt="" style={{ width: 16, height: 16, filter: 'invert(1)', opacity: 0.6 }} />
            Affichage
          </h2>
          <div className="settings__row settings__row--col">
            <div className="settings__row-top">
              <label>Résolution au lancement</label>
            </div>
            <div className="settings__res-row">
              {RES_PRESETS.map((p, i) => (
                <button
                  key={i}
                  className={`settings__res-btn ${resPreset === i ? 'settings__res-btn--active' : ''}`}
                  onClick={() => handlePresetChange(i)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {resPreset === 3 && (
              <div className="settings__res-custom">
                <input
                  type="number" min={320} max={3840} step={1}
                  value={resW} onChange={e => handleResWChange(Number(e.target.value))}
                  className="settings__res-input"
                  placeholder="Largeur"
                />
                <span className="settings__res-x">×</span>
                <input
                  type="number" min={240} max={2160} step={1}
                  value={resH} onChange={e => handleResHChange(Number(e.target.value))}
                  className="settings__res-input"
                  placeholder="Hauteur"
                />
              </div>
            )}
            <span className="settings__hint">
              Résolution actuelle&nbsp;: <strong>{resW} × {resH}</strong>
            </span>
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
