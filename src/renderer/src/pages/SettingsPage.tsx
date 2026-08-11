import './SettingsPage.css'
import { useState, useRef, useEffect } from 'react'
import type { LaunchProfile, PerfLevelInfo } from '../hooks/useSkin'
import { setSoundEnabled } from '../utils/sounds'
import UnsavedModal from '../components/UnsavedModal'

function ramHint(ram: number): string {
  if (ram < 4)  return 'En dessous du minimum - risque de lag et de crash.'
  if (ram <= 6) return 'Optimal pour EarthKingdoms. Bonne marge pour le système.'
  if (ram <= 10) return 'Confortable. Utile si tu as des shaders actifs.'
  return 'Attention - laisse au moins 4 Go au système d\'exploitation.'
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

// ── Réglages graphiques exposés au joueur ───────────────────────────────────
//
// Les clés et les valeurs sont celles du options.txt de Minecraft 1.20.1 :
// renderClouds est une chaîne entre guillemets, les autres des nombres ou des
// booléens. On les manipule en texte pour les écrire telles quelles.

type GfxControl =
  | { key: string; label: string; hint?: string; type: 'slider'; min: number; max: number; step: number; unit?: string }
  | { key: string; label: string; hint?: string; type: 'choice'; choices: Array<{ v: string; l: string }> }
  | { key: string; label: string; hint?: string; type: 'toggle' }

const GFX_CONTROLS: GfxControl[] = [
  { key: 'renderDistance', label: 'Distance d\'affichage', type: 'slider', min: 2, max: 32, step: 1, unit: 'chunks',
    hint: 'Le réglage qui pèse le plus lourd sur les FPS.' },
  { key: 'simulationDistance', label: 'Distance de simulation', type: 'slider', min: 2, max: 32, step: 1, unit: 'chunks',
    hint: 'Rayon dans lequel les entités et les blocs restent actifs.' },
  { key: 'maxFps', label: 'Images par seconde', type: 'slider', min: 30, max: 260, step: 10 },
  { key: 'graphicsMode', label: 'Graphismes', type: 'choice',
    choices: [{ v: '0', l: 'Rapides' }, { v: '1', l: 'Détaillés' }] },
  { key: 'particles', label: 'Particules', type: 'choice',
    choices: [{ v: '0', l: 'Toutes' }, { v: '1', l: 'Réduites' }, { v: '2', l: 'Minimales' }] },
  { key: 'renderClouds', label: 'Nuages', type: 'choice',
    choices: [{ v: '"false"', l: 'Aucun' }, { v: '"fast"', l: 'Rapides' }, { v: '"true"', l: 'Détaillés' }] },
  { key: 'entityDistanceScaling', label: 'Distance des entités', type: 'choice',
    choices: [{ v: '0.5', l: '50 %' }, { v: '0.75', l: '75 %' }, { v: '1.0', l: '100 %' }] },
  { key: 'mipmapLevels', label: 'Mipmap', type: 'choice',
    choices: [{ v: '0', l: '0' }, { v: '1', l: '1' }, { v: '2', l: '2' }, { v: '3', l: '3' }, { v: '4', l: '4' }],
    hint: 'Lisse les textures au loin. Coût mémoire vidéo.' },
  { key: 'entityShadows', label: 'Ombres des entités', type: 'toggle' },
  { key: 'enableVsync', label: 'Synchronisation verticale', type: 'toggle',
    hint: 'Supprime le déchirement d\'image, au prix d\'un peu de latence.' },
]

/** Affichage lisible d'une valeur de slider (260 = illimité côté Minecraft). */
function gfxSliderLabel(key: string, value: string, unit?: string): string {
  if (key === 'maxFps' && value === '260') return 'Illimité'
  return unit ? `${value} ${unit}` : value
}

function javaLabel(javaPath: string | null): string {
  if (!javaPath) return 'Java 17 · Embarqué'
  const parts = javaPath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || javaPath
}

function SectionIcon({ src, color }: { src: string; color: 'orange' | 'cyan' | 'amber' | 'violet' | 'danger' }) {
  return (
    <span className={`settings__section-icon settings__section-icon--${color}`}>
      <img src={src} alt="" />
    </span>
  )
}

interface Props {
  savedRam:      number
  onSaveRam:     (v: number) => void
  savedResW:     number
  savedResH:     number
  onSaveRes:     (w: number, h: number) => void
  savedJavaPath: string | null
  onSaveJava:    (path: string | null) => void
  /** Remonte l'existence de modifications non sauvegardées à l'application. */
  onDirtyChange: (dirty: boolean) => void
  /**
   * Action demandée ailleurs dans l'application et mise en attente parce que
   * cette page a des modifications en cours (changement d'onglet, fermeture).
   * La page pose la question, puis répond par onResolveBlocked.
   */
  blockedAction: { label: string } | null
  onResolveBlocked: (proceed: boolean) => void
}

export default function SettingsPage({
  savedRam, onSaveRam,
  savedResW, savedResH, onSaveRes,
  savedJavaPath, onSaveJava,
  onDirtyChange, blockedAction, onResolveBlocked,
}: Props) {
  const [ram,             setRam]             = useState(savedRam)
  const [resPreset,       setResPreset]       = useState(() => getPresetIndex(savedResW, savedResH))
  const [resW,            setResW]            = useState(savedResW)
  const [resH,            setResH]            = useState(savedResH)
  const [javaPath,        setJavaPath]        = useState<string | null>(savedJavaPath)
  const [saved,           setSaved]           = useState(false)
  const [totalRam,        setTotalRam]        = useState<number | null>(null)
  const [profiles,        setProfiles]        = useState<LaunchProfile[]>([])
  const [activeProfileId, setActiveProfileId] = useState('perf-medium')
  const [modCounts,       setModCounts]       = useState<Record<string, number>>({})
  const [levelInfos,      setLevelInfos]      = useState<PerfLevelInfo[]>([])
  const [newProfileName,  setNewProfileName]  = useState('')
  const [showNewProfile,  setShowNewProfile]  = useState(false)
  const [gfxMsg,          setGfxMsg]          = useState<string | null>(null)
  const [applyingGfx,     setApplyingGfx]     = useState(false)
  const [pendingProfile,  setPendingProfile]  = useState<string | null>(null)
  const [savingGuard,     setSavingGuard]     = useState(false)
  const [gfx,             setGfx]             = useState<Record<string, string>>({})
  const [gfxSaved,        setGfxSaved]        = useState<Record<string, string>>({})
  const [gfxDefaults,     setGfxDefaults]     = useState<Record<string, string>>({})
  const [soundOn,         setSoundOn]         = useState(true)
  const [startupOn,       setStartupOn]       = useState(false)
  const [closeOnLaunch,   setCloseOnLaunch]   = useState(false)
  const [repairing,       setRepairing]       = useState(false)
  const [repairMsg,       setRepairMsg]       = useState<string | null>(null)
  const [appVersion,      setAppVersion]      = useState('…')
  const [checkingUpdate,  setCheckingUpdate]  = useState(false)
  const [updateMsg,       setUpdateMsg]       = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const gfxDirty = GFX_CONTROLS.some(c => gfx[c.key] !== undefined && gfx[c.key] !== gfxSaved[c.key])

  const dirty =
    ram !== savedRam ||
    resW !== savedResW || resH !== savedResH ||
    javaPath !== savedJavaPath ||
    gfxDirty

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

  // L'application a besoin de connaître l'état « modifié » pour intercepter la
  // navigation et la fermeture. Au démontage on le remet à false : la page
  // n'existe plus, il n'y a plus rien à perdre.
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  // Charge la RAM système, les profils, le son et les autres réglages au montage
  useEffect(() => {
    window.api.systemTotalRam().then(v => setTotalRam(v)).catch(() => {})
    window.api.perfLevels().then(v => setLevelInfos(v)).catch(() => {})
    loadProfiles()
    loadGameOptions()
    window.api.storeGet('soundEnabled').then(v => {
      if (v !== undefined && v !== null) setSoundOn(Boolean(v))
    }).catch(() => {})
    window.api.storeGet('closeOnLaunch').then(v => {
      if (v !== undefined && v !== null) setCloseOnLaunch(Boolean(v))
    }).catch(() => {})
    window.api.systemGetStartupEnabled().then(v => setStartupOn(v)).catch(() => {})
    window.api.appVersion().then(v => setAppVersion(v)).catch(() => {})
  }, [])

  const activeProfile   = profiles.find(p => p.id === activeProfileId) ?? null
  const activeLevelInfo = levelInfos.find(l => l.level === activeProfile?.perfLevel) ?? null
  const customProfiles  = profiles.filter(p => !p.builtin)

  // La RAM conseillée dépend du palier actif, pas seulement de la machine.
  const recommendedRam = activeLevelInfo?.ram
    ?? (totalRam ? Math.min(16, Math.max(4, Math.round(totalRam * 0.25))) : null)

  async function loadProfiles() {
    try {
      const result = await window.api.profilesList()
      setProfiles(result.profiles)
      setActiveProfileId(result.activeId)
      setModCounts(result.modCounts)
    } catch { /* silencieux */ }
  }

  async function loadGameOptions() {
    try {
      const res = await window.api.perfActiveGameOptions()
      setGfx(res.values)
      setGfxSaved(res.values)
      setGfxDefaults(res.defaults)
    } catch { /* silencieux */ }
  }

  /** Recopie un profil dans l'état local ET dans les clés globales lues ailleurs. */
  function adoptProfile(profile: LaunchProfile) {
    setActiveProfileId(profile.id)
    setRam(profile.ram)
    setResW(profile.resW)
    setResH(profile.resH)
    setJavaPath(profile.javaPath)
    setResPreset(getPresetIndex(profile.resW, profile.resH))
    onSaveRam(profile.ram)
    onSaveRes(profile.resW, profile.resH)
    onSaveJava(profile.javaPath)
    setSaved(false)
    setGfxMsg(null)
    loadGameOptions()
  }

  async function handleProfileChange(id: string) {
    if (id === activeProfileId) return
    // Changer de profil écrase les champs à l'écran : on ne le fait pas
    // par-dessus des modifications que le joueur n'a pas encore enregistrées.
    if (dirty) { setPendingProfile(id); return }
    await switchProfile(id)
  }

  async function switchProfile(id: string) {
    try {
      const applied = await window.api.profilesSetActive(id)
      adoptProfile(applied)
      await loadProfiles()
    } catch { /* silencieux */ }
  }

  /** Remet les champs sur les dernières valeurs enregistrées. */
  function discardChanges() {
    setRam(savedRam)
    setResW(savedResW)
    setResH(savedResH)
    setResPreset(getPresetIndex(savedResW, savedResH))
    setJavaPath(savedJavaPath)
    setGfx(gfxSaved)
    setSaved(false)
  }

  // ── Résolution de la fenêtre « modifications non sauvegardées » ───────────
  //
  // Une seule fenêtre pour deux origines : une action interne à la page
  // (changement de profil) ou une action venue de l'application (changement
  // d'onglet, fermeture). Les trois issues sont les mêmes dans les deux cas.

  function finishGuard(proceed: boolean) {
    const profileId = pendingProfile
    setPendingProfile(null)
    if (profileId) { if (proceed) switchProfile(profileId) }
    else           { onResolveBlocked(proceed) }
  }

  async function handleGuardSave() {
    setSavingGuard(true)
    try { await handleSave() } catch { /* silencieux */ }
    setSavingGuard(false)
    finishGuard(true)
  }

  function handleGuardDiscard() {
    discardChanges()
    finishGuard(true)
  }

  async function handleNewProfile() {
    if (!newProfileName.trim()) return
    // Le nouveau profil part du profil actif - y compris sa sélection de mods,
    // qui est figée à ce moment-là et n'évoluera plus avec le palier.
    const created = await window.api.profilesCreate(newProfileName.trim(), activeProfileId)
    setNewProfileName('')
    setShowNewProfile(false)
    adoptProfile(created)
    await loadProfiles()
  }

  async function handleDeleteProfile() {
    const target = profiles.find(p => p.id === activeProfileId)
    if (!target || target.builtin) return
    await window.api.profilesDelete(activeProfileId)
    const fallback = await window.api.profilesSetActive('perf-medium')
    adoptProfile(fallback)
    await loadProfiles()
  }

  /** Rend un profil personnalisé aux réglages de son palier. */
  async function handleReset(what: 'mods' | 'gameOptions' | 'all') {
    await window.api.profilesReset(activeProfileId, what)
    await loadProfiles()
    await loadGameOptions()
    setGfxMsg(what === 'mods'
      ? '✓ Sélection de mods réalignée sur le palier.'
      : '✓ Réglages graphiques réalignés sur le palier.')
  }

  function handleGfxChange(key: string, value: string) {
    setGfx(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function handleApplyGameOptions() {
    setApplyingGfx(true)
    setGfxMsg(null)
    try {
      const res = await window.api.perfApplyGameOptions()
      if (res.cancelled)      setGfxMsg(null)
      else if (!res.ok)       setGfxMsg(res.error ?? 'Erreur inconnue.')
      else if (!res.applied)  setGfxMsg('Rien à faire - le jeu n\'est pas encore installé, les réglages seront écrits au premier lancement.')
      else                    setGfxMsg(`✓ Réglages appliqués (${res.applied} installation${res.applied > 1 ? 's' : ''}).`)
    } catch {
      setGfxMsg('Erreur inconnue.')
    } finally {
      setApplyingGfx(false)
    }
  }

  async function handleToggleSound() {
    const next = !soundOn
    setSoundOn(next)
    setSoundEnabled(next)
    await window.api.storeSet('soundEnabled', next)
  }

  async function handleToggleStartup() {
    const next = !startupOn
    setStartupOn(next)
    await window.api.systemSetStartupEnabled(next)
  }

  async function handleToggleCloseOnLaunch() {
    const next = !closeOnLaunch
    setCloseOnLaunch(next)
    await window.api.storeSet('closeOnLaunch', next)
  }

  async function handleRepair() {
    setRepairing(true)
    setRepairMsg(null)
    try {
      const res = await window.api.repairMods()
      if (res.cancelled) { setRepairMsg(null) }
      else if (res.ok)    { setRepairMsg('✓ Fait - les mods seront retéléchargés au prochain lancement.') }
      else                { setRepairMsg(res.error ?? 'Erreur inconnue.') }
    } catch {
      setRepairMsg('Erreur inconnue.')
    } finally {
      setRepairing(false)
    }
  }

  async function handleCheckUpdate() {
    setCheckingUpdate(true)
    setUpdateMsg(null)
    try {
      const res = await window.api.updateCheck()
      if (res.available) setUpdateMsg('Mise à jour trouvée - téléchargement en cours…')
      else if (res.macUpdate && res.latestVersion) setUpdateMsg(`Version ${res.latestVersion} disponible (voir GitHub).`)
      else setUpdateMsg('✓ Tu es à jour.')
    } catch {
      setUpdateMsg('Impossible de vérifier pour le moment.')
    } finally {
      setCheckingUpdate(false)
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

  /**
   * Enregistre les modifications sur le profil actif. Si c'est un palier
   * intégré, le main process en dérive un profil personnalisé plutôt que de
   * modifier le palier - on l'annonce, sinon le changement de nom surprend.
   */
  async function handleSave() {
    let created = false
    let name    = activeProfile?.name ?? ''
    try {
      const res = await window.api.profilesUpdate({ ram, resW, resH, javaPath })
      created = res.created
      name    = res.profile.name

      if (gfxDirty) {
        const gfxRes = await window.api.perfSetGameOptions(gfx)
        created = created || gfxRes.created
        name    = gfxRes.profileName
      }
    } catch { /* silencieux */ }

    onSaveRam(ram)
    onSaveRes(resW, resH)
    onSaveJava(javaPath)
    setGfxSaved(gfx)
    await loadProfiles()
    await loadGameOptions()

    setSaved(true)
    setGfxMsg(created ? `✓ Profil « ${name} » créé - le palier d'origine est intact.` : null)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setSaved(false), 2500)
  }

  const guardAction = pendingProfile
    ? 'Changer de profil remplacera les valeurs affichées.'
    : blockedAction?.label ?? ''

  return (
    <div className="settings">
      {(pendingProfile || blockedAction) && (
        <UnsavedModal
          action={guardAction}
          saving={savingGuard}
          onSave={handleGuardSave}
          onDiscard={handleGuardDiscard}
          onCancel={() => finishGuard(false)}
        />
      )}

      <div className="settings__content">
        <div className="settings__page-label">Configuration</div>

        {/* ── Palier de performance & profils ──────────────────────────────
            Volontairement hors de la grille deux colonnes : les trois cartes
            de palier ont besoin de toute la largeur pour rester lisibles. */}
        <section className="settings__section settings__section--full">
          <h2 className="settings__section-title">
            <SectionIcon src="./icons/settings.svg" color="orange" />
            Niveau de performance
          </h2>

          <div className="tiers">
            {levelInfos.map(info => {
              const id      = `perf-${info.level}`
              const profile = profiles.find(p => p.id === id)
              const active  = activeProfileId === id
              return (
                <button
                  key={id}
                  className={`tier ${active ? 'tier--active' : ''}`}
                  onClick={() => handleProfileChange(id)}
                >
                  <span className="tier__name">{info.label}</span>
                  <span className="tier__desc">{info.desc}</span>
                  <span className="tier__meta">
                    {(profile?.ram ?? info.ram)} Go
                    {modCounts[id] !== undefined && ` · ${modCounts[id]} mods optionnels`}
                  </span>
                </button>
              )
            })}
          </div>

          {customProfiles.length > 0 && (
            <div className="tiers__customs">
              <span className="tiers__customs-label">Profils personnalisés</span>
              <div className="tiers__chips">
                {customProfiles.map(p => (
                  <button
                    key={p.id}
                    className={`profile-chip ${activeProfileId === p.id ? 'profile-chip--active' : ''}`}
                    onClick={() => handleProfileChange(p.id)}
                    title={`Basé sur le palier ${levelInfos.find(l => l.level === p.perfLevel)?.label ?? p.perfLevel}`}
                  >
                    {p.name}
                    <span className="profile-chip__meta">{modCounts[p.id] ?? 0} mods</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="settings__row tiers__actions">
            <div>
              <label>Profil actif&nbsp;: {activeProfile?.name ?? '…'}</label>
              <span className="settings__hint">
                {activeProfile?.builtin
                  ? 'Palier intégré, non modifiable. Changer un réglage crée un profil personnalisé qui en dérive - le palier reste intact et tu peux y revenir.'
                  : `Profil personnalisé, dérivé du palier ${activeLevelInfo?.label ?? activeProfile?.perfLevel ?? ''}.`}
              </span>
            </div>
            <div className="tiers__buttons">
              {activeProfile && !activeProfile.builtin && activeProfile.mods && (
                <button className="btn-secondary" onClick={() => handleReset('mods')}>Réaligner les mods</button>
              )}
              {activeProfile && !activeProfile.builtin && activeProfile.gameOptions && (
                <button className="btn-secondary" onClick={() => handleReset('gameOptions')}>Réaligner les graphismes</button>
              )}
              {activeProfile && !activeProfile.builtin && (
                <button className="btn-secondary" onClick={handleDeleteProfile}>Supprimer</button>
              )}
              {!showNewProfile && (
                <button className="btn-secondary" onClick={() => setShowNewProfile(true)}>+ Nouveau profil</button>
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
              <button className="btn-secondary" onClick={handleNewProfile} disabled={!newProfileName.trim()}>
                Créer depuis « {activeProfile?.name ?? '…'} »
              </button>
              <button className="btn-secondary" onClick={() => { setShowNewProfile(false); setNewProfileName('') }}>Annuler</button>
            </div>
          )}

          {gfxMsg && (
            <span
              className={`settings__hint ${gfxMsg.startsWith('✓') ? 'settings__hint--ok' : 'settings__hint--warn'}`}
              style={{ padding: '2px 16px 0' }}
            >
              {gfxMsg}
            </span>
          )}
        </section>

        {/* ── Réglages graphiques du jeu ───────────────────────────────────
            Le palier fixe des valeurs de départ ; chaque ligne reste
            modifiable à la main. Une valeur ramenée sur celle du palier
            cesse d'être une surcharge et suit à nouveau le palier. */}
        <section className="settings__section settings__section--full">
          <h2 className="settings__section-title">
            <SectionIcon src="./icons/screen.svg" color="cyan" />
            Réglages graphiques du jeu
          </h2>

          <div className="gfx">
            {GFX_CONTROLS.map(ctrl => {
              const value    = gfx[ctrl.key] ?? gfxDefaults[ctrl.key] ?? ''
              const modified = gfxDefaults[ctrl.key] !== undefined && value !== gfxDefaults[ctrl.key]
              return (
                <div key={ctrl.key} className={`settings__row settings__row--col gfx__row ${modified ? 'gfx__row--modified' : ''}`}>
                  <div className="settings__row-top">
                    <label>
                      {ctrl.label}
                      {modified && <span className="gfx__dot" title="Modifié par rapport au palier" />}
                    </label>
                    {ctrl.type === 'slider' && (
                      <span className="gfx__value">{gfxSliderLabel(ctrl.key, value, ctrl.unit)}</span>
                    )}
                    {ctrl.type === 'toggle' && (
                      <button
                        className={`settings__toggle ${value === 'true' ? 'settings__toggle--on' : ''}`}
                        onClick={() => handleGfxChange(ctrl.key, value === 'true' ? 'false' : 'true')}
                        role="switch"
                        aria-checked={value === 'true'}
                      >
                        <span className="settings__toggle-knob" />
                      </button>
                    )}
                  </div>

                  {ctrl.type === 'slider' && (
                    <input
                      type="range"
                      min={ctrl.min} max={ctrl.max} step={ctrl.step}
                      value={Number(value) || ctrl.min}
                      onChange={e => handleGfxChange(ctrl.key, e.target.value)}
                      className="settings__slider"
                      style={{ '--fill': `${((Number(value) - ctrl.min) / (ctrl.max - ctrl.min)) * 100}%` } as React.CSSProperties}
                    />
                  )}

                  {ctrl.type === 'choice' && (
                    <div className="settings__res-row">
                      {ctrl.choices.map(c => (
                        <button
                          key={c.v}
                          className={`settings__res-btn ${value === c.v ? 'settings__res-btn--active' : ''}`}
                          onClick={() => handleGfxChange(ctrl.key, c.v)}
                        >
                          {c.l}
                        </button>
                      ))}
                    </div>
                  )}

                  {ctrl.hint && <span className="settings__hint">{ctrl.hint}</span>}
                </div>
              )
            })}
          </div>

          <div className="settings__row">
            <div>
              <label>Écrire ces réglages dans le jeu</label>
              <span className="settings__hint">
                Appliqués tout seuls à la première installation. Ici, ils remplacent tes réglages
                actuels - tes raccourcis clavier, volumes et champ de vision ne sont pas touchés.
              </span>
            </div>
            <button className="btn-secondary gfx__apply" onClick={handleApplyGameOptions} disabled={applyingGfx}>
              {applyingGfx ? 'Application…' : 'Appliquer au jeu'}
            </button>
          </div>
        </section>

        <div className="settings__grid">
        {/* ── Général ─────────────────────────────────────── */}
        <section className="settings__section">
          <h2 className="settings__section-title">
            <SectionIcon src="./icons/settings.svg" color="cyan" />
            Général
          </h2>
          <div className="settings__row">
            <div>
              <label>Sons de l'interface</label>
              <span className="settings__hint">Sons synthétiques sur les boutons, le lancement et les modales.</span>
            </div>
            <button
              className={`settings__toggle ${soundOn ? 'settings__toggle--on' : ''}`}
              onClick={handleToggleSound}
              role="switch"
              aria-checked={soundOn}
              title={soundOn ? 'Désactiver les sons' : 'Activer les sons'}
            >
              <span className="settings__toggle-knob" />
            </button>
          </div>
          <div className="settings__row">
            <div>
              <label>Lancer au démarrage de Windows</label>
              <span className="settings__hint">Ouvre le launcher automatiquement à l'allumage du PC.</span>
            </div>
            <button
              className={`settings__toggle ${startupOn ? 'settings__toggle--on' : ''}`}
              onClick={handleToggleStartup}
              role="switch"
              aria-checked={startupOn}
              title={startupOn ? 'Désactiver' : 'Activer'}
            >
              <span className="settings__toggle-knob" />
            </button>
          </div>
          <div className="settings__row">
            <div>
              <label>Fermer le launcher au lancement du jeu</label>
              <span className="settings__hint">Sinon il se met juste en réduit et revient à la fermeture de Minecraft.</span>
            </div>
            <button
              className={`settings__toggle ${closeOnLaunch ? 'settings__toggle--on' : ''}`}
              onClick={handleToggleCloseOnLaunch}
              role="switch"
              aria-checked={closeOnLaunch}
              title={closeOnLaunch ? 'Désactiver' : 'Activer'}
            >
              <span className="settings__toggle-knob" />
            </button>
          </div>
        </section>

        {/* ── RAM ─────────────────────────────────────────── */}
        <section className="settings__section">
          <h2 className="settings__section-title">
            <SectionIcon src="./icons/ram.svg" color="orange" />
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
                Machine : {totalRam} Go · Recommandé
                {activeLevelInfo ? ` pour le palier ${activeLevelInfo.label}` : ''} :{' '}
                <strong>{recommendedRam} Go</strong>
              </span>
            )}
          </div>
        </section>

        {/* ── Java ────────────────────────────────────────── */}
        <section className="settings__section">
          <h2 className="settings__section-title">
            <SectionIcon src="./icons/java.svg" color="amber" />
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
            <SectionIcon src="./icons/screen.svg" color="violet" />
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

        {/* ── Maintenance ─────────────────────────────────── */}
        <section className="settings__section">
          <h2 className="settings__section-title">
            <SectionIcon src="./icons/repair.svg" color="danger" />
            Maintenance
          </h2>
          <div className="settings__row">
            <div>
              <label>Réparer l'installation</label>
              <span className="settings__hint">
                En cas de crash au lancement ou de mod corrompu : retélécharge proprement les mods.
                Tes mondes et réglages ne sont pas touchés.
              </span>
            </div>
            <button className="btn-secondary" onClick={handleRepair} disabled={repairing}>
              {repairing ? 'En cours…' : 'Réparer'}
            </button>
          </div>
          {repairMsg && (
            <span className={`settings__hint ${repairMsg.startsWith('✓') ? 'settings__hint--ok' : 'settings__hint--warn'}`} style={{ padding: '2px 16px 0' }}>
              {repairMsg}
            </span>
          )}
        </section>

        {/* ── À propos ────────────────────────────────────── */}
        <section className="settings__section">
          <h2 className="settings__section-title settings__section-title--muted">
            À propos
          </h2>
          <div className="settings__row">
            <div>
              <label>Version du launcher</label>
              <span className="settings__hint">
                {updateMsg ?? 'EarthKingdoms Launcher'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
              <span className="settings__badge">v{appVersion}</span>
              <button className="btn-secondary" onClick={handleCheckUpdate} disabled={checkingUpdate}>
                {checkingUpdate ? 'Vérification…' : 'Vérifier les mises à jour'}
              </button>
            </div>
          </div>
        </section>
        </div>

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
