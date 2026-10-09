import { useState, useEffect } from 'react'
import { GamePlayer, GameJob, useSkinHead } from '../hooks/useSkin'
import { Sprout, Pickaxe, Crosshair, Layers, Sword, CircleX, TrendingUp, Clock, User } from 'lucide-react'
import './PlayerStatusPage.css'

const JOB_LABELS: Record<string, string> = {
    farmer: 'Farmer',
    miner:  'Miner',
    hunter: 'Hunter',
}

const JOB_COLORS: Record<string, string> = {
    farmer: '#E6B422',
    miner:  '#E2504A',
    hunter: '#4C7DFF',
}
const DEFAULT_JOB_COLOR = '#B8B8C9'

function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const JOB_ICONS: Record<string, JSX.Element> = {
    farmer: <Sprout    size={22} strokeWidth={1.6} />,
    miner:  <Pickaxe   size={22} strokeWidth={1.6} />,
    hunter: <Crosshair size={22} strokeWidth={1.6} />,
}

const DEFAULT_JOB_ICON = <Layers size={22} strokeWidth={1.6} />

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
    return new Intl.NumberFormat('fr-FR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })
        .format(n)
        .replace(/\u202F/g, '.')
        .replace(/\u00A0/g, '.')
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
                            Le serveur de jeu ne répond pas pour le moment ! Certaines informations ne sont pas disponibles...
                        </div>
                    )}

                    {/* ── Bandeau identité ─────────────────────────────────── */}
                    <div className="player-status__hero">
                        <div className={`player-status__hero-avatar ${player.online ? 'player-status__hero-avatar--online' : ''}`}>
                            {headUrl
                                ? <img src={headUrl} alt="" />
                                : <User className="player-status__hero-avatar--fallback" size={16} strokeWidth={2} />
                            }
                            <span className={`player-status__hero-dot ${player.online ? 'player-status__hero-dot--on' : ''}`} />
                        </div>

                        <div className="player-status__hero-info">
                            <div className="player-status__hero-name-row">
                                <span className="player-status__hero-name">{player.name}</span>
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
                            <span className="player-status__hero-balance-value">
                                {player.balance !== null
                                    ? <>{formatBalance(player.balance)} <span className="player-status__currency">Ƶ</span></>
                                    : NA}
                            </span>
                        </div>
                    </div>

                    {/* ── Stats de combat ──────────────────────────────────── */}
                    <div className="player-status__stats">
                        <div className="player-status__stat-tile">
                            <div className="player-status__stat-icon">
                                <Sword size={20} strokeWidth={1.8} />
                            </div>
                            <span className="player-status__stat-value">{player.kills ?? NA}</span>
                            <span className="player-status__stat-label">Éliminations</span>
                        </div>
                        <div className="player-status__stat-tile">
                            <div className="player-status__stat-icon player-status__stat-icon--danger">
                                <CircleX size={20} strokeWidth={1.8} />
                            </div>
                            <span className="player-status__stat-value">{player.deaths ?? NA}</span>
                            <span className="player-status__stat-label">Morts</span>
                        </div>
                        <div className="player-status__stat-tile">
                            <div className="player-status__stat-icon player-status__stat-icon--info">
                                <TrendingUp size={20} strokeWidth={1.8} />
                            </div>
                            <span className="player-status__stat-value">{player.kda !== null ? player.kda.toFixed(2) : NA}</span>
                            <span className="player-status__stat-label">É/M</span>
                        </div>
                        <div className="player-status__stat-tile">
                            <div className="player-status__stat-icon player-status__stat-icon--time">
                                <Clock size={20} strokeWidth={1.8} />
                            </div>
                            <span className="player-status__stat-value">{player.playtime ?? NA}</span>
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
                                        <span className="player-status__job-level font-mc" style={{ color }}>Niveau {job.level}</span>
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
