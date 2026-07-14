import { useState, useEffect } from 'react'
import { GamePlayer, GameJob, useSkinHead } from '../hooks/useSkin'
import './PlayerStatusPage.css'

const JOB_LABELS: Record<string, string> = {
  farmer:     'Agriculteur',
  miner:      'Mineur',
  hunter:     'Chasseur',
  lumberjack: 'Bûcheron',
  fisherman:  'Pêcheur',
  builder:    'Bâtisseur',
  merchant:   'Marchand',
  soldier:    'Soldat',
}

const JOB_COLORS: Record<string, string> = {
  farmer:     '#4CAF50',
  miner:      '#7C8DB5',
  hunter:     '#E74C3C',
  lumberjack: '#A0684B',
  fisherman:  '#3BC9DB',
  builder:    '#EC8200',
  merchant:   '#F1C40F',
  soldier:    '#C0392B',
}
const DEFAULT_JOB_COLOR = '#B8B8C9'

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const JOB_ICONS: Record<string, JSX.Element> = {
  farmer: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22V12M12 12C12 7 8 4 4 4c0 5 3 8 8 8zM12 12c0-4 3-7 8-7 0 4-3 7-8 7z"/>
    </svg>
  ),
  miner: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2 3 13.5 6 21l7.5-11.5L21 6z"/><path d="M14.5 2 21 6"/>
    </svg>
  ),
  hunter: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20 20 4M14 4h6v6M6 14v6h6"/>
    </svg>
  ),
  lumberjack: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3v18M6 3l12 6-12 6"/>
    </svg>
  ),
  fisherman: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 12c3-5 8-7 12-5-1 4-3 7-6 8-4 1.5-7.5.5-9.5-1a3 3 0 1 1 2-4.5"/>
    </svg>
  ),
  builder: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="10" width="7" height="11"/><rect x="14" y="4" width="7" height="17"/>
    </svg>
  ),
  merchant: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="21" r="1.5"/><circle cx="18" cy="21" r="1.5"/>
      <path d="M2.5 3h2l2.6 12.6a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 8H6"/>
    </svg>
  ),
  soldier: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6z"/>
    </svg>
  ),
}

const DEFAULT_JOB_ICON = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
  </svg>
)

/** Résout le libellé d'un métier - le nom peut être une chaîne simple ou un
 *  composant de traduction Minecraft brut (objet JSON), selon la version du jeu. */
function jobKey(name: GameJob['name']): string {
  if (typeof name === 'string') return name.split('.').pop() ?? name
  const key = (name?.f_237194_ as Record<string, unknown> | undefined)?.f_237497_
  return typeof key === 'string' ? (key.split('.').pop() ?? '') : ''
}

function getJobLabel(name: GameJob['name']): string {
  const raw = jobKey(name)
  if (!raw) return 'Métier'
  return JOB_LABELS[raw] ?? (raw.charAt(0).toUpperCase() + raw.slice(1))
}

function formatBalance(n: number): string {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n))
}

const NA = <span className="player-status__na">N/A</span>

export default function PlayerStatusPage() {
  const [player,        setPlayer]        = useState<GamePlayer | null>(null)
  const [dataAvailable, setDataAvailable] = useState(true)
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState<string | null>(null)

  const headUrl = useSkinHead(player?.name ?? '')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await window.api.statusPlayer()
        if (cancelled) return
        if (!res.ok || !res.player) setError(res.error ?? 'Statut indisponible.')
        else {
          setPlayer(res.player)
          setDataAvailable(res.dataAvailable ?? true)
        }
      } catch {
        if (!cancelled) setError('Erreur réseau.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="player-status">
      <div className="player-status__header">
        <h1 className="player-status__title">Statut Joueur</h1>
      </div>

      {loading && <p className="player-status__empty">Chargement…</p>}
      {!loading && error && <p className="player-status__empty player-status__empty--error">{error}</p>}

      {!loading && player && (
        <div className="player-status__content">
          {!dataAvailable && (
            <div className="player-status__unavailable">
              Le serveur de jeu ne répond pas pour le moment - certaines infos ne sont pas disponibles.
            </div>
          )}

          {/* ── Bandeau identité ─────────────────────────────────── */}
          <div className="player-status__hero">
            <div className={`player-status__hero-avatar ${player.online ? 'player-status__hero-avatar--online' : ''}`}>
              {headUrl
                ? <img src={headUrl} alt="" />
                : <img src="./icons/avatar-default.svg" className="player-status__hero-avatar--fallback" alt="" />
              }
              <span className={`player-status__hero-dot ${player.online ? 'player-status__hero-dot--on' : ''}`} />
            </div>

            <div className="player-status__hero-info">
              <div className="player-status__hero-name-row">
                <span className="player-status__hero-name">{player.name}</span>
                {/* "Hors jeu" plutôt que "hors ligne" : le joueur est forcément connecté au
                    launcher/site pour voir cette page - ce statut ne reflète que le fait
                    d'être ou non actuellement dans la partie Minecraft, pas l'authentification. */}
                <span className={`player-status__hero-online ${player.online ? 'player-status__hero-online--on' : ''}`}>
                  {player.online === null ? 'Statut inconnu' : player.online ? 'En jeu' : 'Hors jeu'}
                </span>
              </div>
              <div className="player-status__hero-tags">
                {!dataAvailable ? (
                  <span className="player-status__tag player-status__tag--muted">{NA}</span>
                ) : player.nationName ? (
                  <>
                    <span className="player-status__tag">{player.nationName}</span>
                    {player.nationRank && <span className="player-status__tag player-status__tag--accent">{player.nationRank}</span>}
                  </>
                ) : (
                  <span className="player-status__tag player-status__tag--muted">Aucune nation</span>
                )}
              </div>
            </div>

            <div className="player-status__hero-balance">
              <span className="player-status__hero-balance-label">Solde</span>
              <span className="player-status__hero-balance-value font-mc">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="12" cy="12" r="8.5"/>
                  <path d="M12 6.5v11M9.5 9h3.5a1.6 1.6 0 0 1 0 3.2h-2a1.6 1.6 0 0 0 0 3.2h3.5"/>
                </svg>
                {player.balance !== null ? <>{formatBalance(player.balance)} ₴</> : NA}
              </span>
            </div>
          </div>

          {/* ── Stats de combat ──────────────────────────────────── */}
          <div className="player-status__stats">
            <div className="player-status__stat-tile">
              <div className="player-status__stat-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.5 2 3 13.5 6 21l7.5-11.5L21 6z"/>
                </svg>
              </div>
              <span className="player-status__stat-value font-mc">{player.kills ?? NA}</span>
              <span className="player-status__stat-label">Kills</span>
            </div>
            <div className="player-status__stat-tile">
              <div className="player-status__stat-icon player-status__stat-icon--danger">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>
                </svg>
              </div>
              <span className="player-status__stat-value font-mc">{player.deaths ?? NA}</span>
              <span className="player-status__stat-label">Morts</span>
            </div>
            <div className="player-status__stat-tile">
              <div className="player-status__stat-icon player-status__stat-icon--info">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 17l6-6 4 4 8-8"/><path d="M21 7v6h-6"/>
                </svg>
              </div>
              <span className="player-status__stat-value font-mc">{player.kda !== null ? player.kda.toFixed(2) : NA}</span>
              <span className="player-status__stat-label">K/D</span>
            </div>
            <div className="player-status__stat-tile">
              <div className="player-status__stat-icon player-status__stat-icon--time">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/>
                </svg>
              </div>
              <span className="player-status__stat-value font-mc">{player.playtime ?? NA}</span>
              <span className="player-status__stat-label">Temps de jeu</span>
            </div>
          </div>

          {/* ── Métiers ──────────────────────────────────────────── */}
          <div className="player-status__jobs">
            <p className="player-status__section-label">Métiers</p>
            {player.jobs === null && <p className="player-status__empty">Indisponible pour le moment.</p>}
            {player.jobs?.length === 0 && <p className="player-status__empty">Aucun métier.</p>}
            <div className="player-status__jobs-grid">
              {player.jobs?.map((job, i) => {
                const key   = jobKey(job.name)
                const color = JOB_COLORS[key] ?? DEFAULT_JOB_COLOR
                return (
                  <div key={i} className="player-status__job-card">
                    <div className="player-status__job-icon" style={{ color, background: hexToRgba(color, 0.14) }}>
                      {JOB_ICONS[key] ?? DEFAULT_JOB_ICON}
                    </div>
                    <span className="player-status__job-name">{getJobLabel(job.name)}</span>
                    <span className="player-status__job-level font-mc" style={{ color }}>Niv. {job.level}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
