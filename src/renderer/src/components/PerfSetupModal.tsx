import { useEffect, useState } from 'react'
import type { HardwareInfo, PerfLevel, PerfLevelInfo } from '../hooks/useSkin'
import './PerfSetupModal.css'

// Proposition de palier au premier démarrage.
//
// Le launcher détecte, explique ce qu'il a vu, et laisse le joueur trancher :
// une machine mal identifiée (GPU derrière ANGLE, portable à double carte)
// ne doit jamais enfermer quelqu'un dans un palier trop bas sans recours.

const GPU_KIND_LABEL: Record<HardwareInfo['gpuKind'], string> = {
  dedicated:  'carte dédiée',
  integrated: 'carte intégrée',
  unknown:    'non identifiée',
}

interface Props {
  onDone: () => void
}

export default function PerfSetupModal({ onDone }: Props) {
  const [hw,       setHw]       = useState<HardwareInfo | null>(null)
  const [levels,   setLevels]   = useState<PerfLevelInfo[]>([])
  const [picked,   setPicked]   = useState<PerfLevel | null>(null)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([window.api.perfHardware(), window.api.perfLevels()])
      .then(([hardware, levelInfos]) => {
        if (cancelled) return
        setHw(hardware)
        setLevels(levelInfos)
        setPicked(hardware.recommended)
      })
      .catch(() => {
        // Détection impossible : on n'enferme pas le joueur dans une modale
        // vide, le palier Moyen par défaut reste en place.
        if (cancelled) return
        window.api.perfDismissSetup().catch(() => {})
        onDone()
      })
    return () => { cancelled = true }
  }, [onDone])

  async function handleConfirm() {
    if (!picked) return
    setApplying(true)
    try {
      await window.api.perfChooseLevel(picked)
    } catch { /* le palier Moyen par défaut reste en place */ }
    onDone()
  }

  async function handleSkip() {
    try { await window.api.perfDismissSetup() } catch { /* silencieux */ }
    onDone()
  }

  const loading = !hw || levels.length === 0

  return (
    <div className="perf-setup">
      <div className="perf-setup__card">
        <div className="perf-setup__head">
          <span className="perf-setup__label">Première configuration</span>
          <h2 className="perf-setup__title">Choisis ton niveau de performance</h2>
          <p className="perf-setup__intro">
            Il détermine les mods activés, la mémoire allouée et les réglages graphiques du jeu.
            Tu pourras en changer à tout moment dans les paramètres.
          </p>
        </div>

        {loading ? (
          <p className="perf-setup__loading">Analyse de ta machine…</p>
        ) : (
          <>
            <div className="perf-setup__hw">
              <div className="perf-setup__hw-item">
                <span className="perf-setup__hw-key">Processeur</span>
                <span className="perf-setup__hw-val" title={hw.cpuModel}>{hw.cpuCores} cœurs</span>
              </div>
              <div className="perf-setup__hw-item">
                <span className="perf-setup__hw-key">Mémoire</span>
                <span className="perf-setup__hw-val">{hw.totalRamGB} Go</span>
              </div>
              <div className="perf-setup__hw-item">
                <span className="perf-setup__hw-key">Carte graphique</span>
                <span className="perf-setup__hw-val" title={hw.gpuName ?? undefined}>
                  {hw.gpuName ?? GPU_KIND_LABEL[hw.gpuKind]}
                </span>
              </div>
            </div>

            <div className="perf-setup__levels">
              {levels.map(info => {
                const isRecommended = info.level === hw.recommended
                const isPicked      = info.level === picked
                return (
                  <button
                    key={info.level}
                    className={`perf-card ${isPicked ? 'perf-card--picked' : ''}`}
                    onClick={() => setPicked(info.level)}
                  >
                    <span className="perf-card__top">
                      <span className="perf-card__name">{info.label}</span>
                      {isRecommended && <span className="perf-card__rec">Recommandé</span>}
                    </span>
                    <span className="perf-card__desc">{info.desc}</span>
                    <span className="perf-card__meta">
                      {info.ram} Go de RAM · {info.gameOptions.renderDistance} chunks
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="perf-setup__actions">
              <button className="btn-secondary" onClick={handleSkip} disabled={applying}>
                Plus tard
              </button>
              <button className="btn-primary" onClick={handleConfirm} disabled={applying || !picked}>
                {applying ? 'Application…' : 'Continuer'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
