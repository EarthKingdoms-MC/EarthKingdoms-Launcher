import { useState, useEffect } from 'react'
import './HomePage.css'
import { useNews }             from '../hooks/useNews'
import { useServerStatus }     from '../hooks/useServerStatus'
import type { LaunchProgressEvent } from '../hooks/useSkin'

const STEP_LABELS: Record<string, string> = {
  check:    'Vérification des fichiers…',
  progress: 'Téléchargement du modpack…',
  extract:  'Extraction des fichiers…',
  patch:    'Mise à jour de Minecraft…',
}

export default function HomePage() {
  const { news, loading: newsLoading }     = useNews()
  const { status, loading: serverLoading } = useServerStatus()

  const [launching,  setLaunching]  = useState(false)
  const [progress,   setProgress]   = useState(-1)  // -1 = indéterminé
  const [stepLabel,  setStepLabel]  = useState('')
  const [launchErr,  setLaunchErr]  = useState('')

  const dotState    = serverLoading ? 'loading' : status.online ? 'online' : 'offline'
  const playerCount = status.online ? status.players    : 0
  const maxPlayers  = status.online ? status.maxPlayers : 0
  const ping        = status.online ? status.ping       : 0

  // Restaure l'état si un lancement est déjà en cours (navigation aller-retour)
  useEffect(() => {
    window.api.launchIsRunning().then(running => {
      if (running) {
        setLaunching(true)
        setProgress(-1)
        setStepLabel('Minecraft en cours…')
      }
    })
  }, [])

  // Abonnements aux événements de lancement
  useEffect(() => {
    const onProgress = (data: LaunchProgressEvent) => {
      if (data.event === 'speed') return
      // task peut valoir 0 au début — on normalise sans court-circuit sur 0
      const pct = (data.total != null && data.total > 0)
        ? Math.min(100, Math.round(((data.task ?? 0) / data.total) * 100))
        : -1  // -1 = indéterminé (pas d'info de total)
      setProgress(pct)
      setStepLabel(STEP_LABELS[data.event] ?? 'Préparation…')
    }

    const onState = (data: { running: boolean }) => {
      if (!data.running) {
        setLaunching(false)
        setProgress(-1)
        setStepLabel('')
      }
    }

    const onError = (data: { message: string }) => {
      setLaunchErr(data.message)
      setLaunching(false)
      setProgress(-1)
      setStepLabel('')
    }

    window.api.on('launch:progress', onProgress as (a: unknown) => void)
    window.api.on('launch:state',    onState    as (a: unknown) => void)
    window.api.on('launch:error',    onError    as (a: unknown) => void)

    return () => {
      window.api.off('launch:progress', onProgress as (a: unknown) => void)
      window.api.off('launch:state',    onState    as (a: unknown) => void)
      window.api.off('launch:error',    onError    as (a: unknown) => void)
    }
  }, [])

  async function handlePlay() {
    if (launching) return
    setLaunchErr('')
    setLaunching(true)
    setProgress(-1)
    setStepLabel('Initialisation…')

    const result = await window.api.launchStart()
    if (!result.ok) {
      setLaunchErr(result.error ?? 'Erreur inconnue.')
      setLaunching(false)
      setProgress(-1)
      setStepLabel('')
    }
    // Si ok: les events gèrent la progression
  }

  return (
    <div className="home">
      <div className="home__bg" />
      <div className="home__grid" />

      {/* Zone centrale */}
      <div className="home__center">
        <div className="home__play-area">

          <div className="home__status-bar">
            <span className={`home__dot home__dot--${dotState}`} />
            <span className="home__status-text">
              {status.online
                ? <><strong className="font-mc">{playerCount}/{maxPlayers}</strong> en ligne</>
                : serverLoading
                  ? 'Connexion…'
                  : <strong>Serveur hors ligne</strong>
              }
            </span>
            <span className="home__status-divider" />
            <span className="home__server-id">SRV-EU</span>
            <span className="home__status-divider" />
            <img src="/icons/ping-low.svg" alt="" className="home__ping" />
            <span className="home__ping-label">{ping > 0 ? `${ping} ms` : '—'}</span>
          </div>

          {status.online && (
            <p className="home__motd">» <em>EarthKingdoms</em> — Rejoignez la lutte pour la suprématie mondiale.</p>
          )}

          <div className="home__hero">
            <span className="home__hero-eyebrow">Saison III — Âge des Nations</span>
            <h1 className="home__hero-title">Conquérez<br /><span className="home__hero-accent">le Monde</span></h1>
          </div>

          {launchErr && (
            <div className="home__launch-error">{launchErr}</div>
          )}

          {!launching ? (
            <button
              className="btn-play"
              onClick={handlePlay}
              disabled={!status.online && !serverLoading}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              {serverLoading ? 'CHARGEMENT…' : status.online ? 'JOUER' : 'HORS LIGNE'}
            </button>
          ) : (
            <div className="home__loading">
              <div className="home__loading-label">
                <span>{stepLabel || 'Préparation…'}</span>
                {progress >= 0 && <span className="home__loading-pct">{progress}%</span>}
              </div>
              <div className={`progress-bar${progress < 0 ? ' progress-bar--indeterminate' : ''}`}>
                <div
                  className="progress-bar__fill"
                  style={{ width: progress >= 0 ? `${Math.max(progress, 2)}%` : '100%' }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sidebar news */}
      <aside className="home__sidebar">
        <div className="home__sidebar-header">
          <span className="home__sidebar-label">Actualités</span>
          {!newsLoading && <span className="home__sidebar-count">{news.length}</span>}
        </div>
        <div className="home__news-list">
          {newsLoading && (
            <p className="home__news-loading">Chargement…</p>
          )}
          {!newsLoading && news.length === 0 && (
            <p className="home__news-loading">Aucune actualité disponible.</p>
          )}
          {news.map((item, i) => (
            <article
              key={i}
              className="news-card"
              onClick={() => item.url && window.api.openExternal(item.url)}
              style={{ cursor: item.url ? 'pointer' : 'default' }}
            >
              <div className="news-card__meta">
                <span className="news-card__tag">{item.tag}</span>
                <span className="news-card__date">{item.date}</span>
              </div>
              <h3 className="news-card__title">{item.title}</h3>
              {item.desc && <p className="news-card__desc">{item.desc}</p>}
            </article>
          ))}
        </div>
      </aside>
    </div>
  )
}
