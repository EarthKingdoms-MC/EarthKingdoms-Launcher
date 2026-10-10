import { useState, useEffect } from 'react'
import type { LaunchProfile, PerfLevel } from '../hooks/useSkin'
import {Gauge, Sparkles, Cpu, ShieldLock, Layers, TriangleAlert, Settings, Plus } from 'lucide-react'
import './ModsPage.css'
import { CHANNELS } from '../channels'

const TIER_LABELS: Record<PerfLevel, string> = {
    low:    'Optimisation',
    medium: 'Confort',
    high:   'Gourmand',
}

interface OptionalMod {
    path:    string
    size:    number
    name:    string
    version: string
}

const MOD_ICONS: Record<string, JSX.Element> = {
    axiom:             ( <ShieldLock size={24} strokeWidth={2} /> ),
    chunkpregenerator: ( <ShieldLock size={24} strokeWidth={2} /> ),
    xraymod:           ( <ShieldLock size={24} strokeWidth={2} /> ),
    ekcore:            ( <ShieldLock size={24} strokeWidth={2} /> ),
    spark:             ( <ShieldLock size={24} strokeWidth={2} /> ),

    distanthorizons:   ( <Cpu size={24} strokeWidth={2} /> ),
    forgematica:       ( <Gauge size={24} strokeWidth={2} /> ),
    immediatelyfast:   ( <Gauge size={24} strokeWidth={2} /> ),
    jade:              ( <Sparkles size={24} strokeWidth={2} /> ),
    mousetweaks:       ( <Sparkles size={24} strokeWidth={2} /> ),
    appleskin:         ( <Sparkles size={24} strokeWidth={2} /> ),
    embeddium:         ( <Gauge size={24} strokeWidth={2} /> ),
    ferritecore:       ( <Gauge size={24} strokeWidth={2} /> ),
    jei:               ( <Sparkles size={24} strokeWidth={2} /> ),
    modernfix:         ( <Gauge size={24} strokeWidth={2} /> ),
    oculus:            ( <Cpu size={24} strokeWidth={2} /> ),
    soundphysics:      ( <Cpu size={24} strokeWidth={2} /> ),
}

const DEFAULT_ICON = (
    <Layers size={24} strokeWidth={2} />
)

const MOD_NAMES: Record<string, string> = {
    axiom:             'Axiom',
    chunkpregenerator: 'Chunk Pregenerator',
    xraymod:           'XRay',
    ekcore:            'EarthKingdoms Core',
    spark:             'Spark',

    distanthorizons:   'Distant Horizons',
    forgematica:       'Forgematica',
    immediatelyfast:   'ImmediatelyFast',
    jade:              'Jade',
    mousetweaks:       'Mouse Tweaks',
    appleskin:         'AppleSkin',
    embeddium:         'Embeddium',
    ferritecore:       'FerriteCore',
    jei:               'Just Enough Items',
    modernfix:         'ModernFix',
    oculus:            'Oculus',
    soundphysics:      'Sound Physics Remastered',
}

const MOD_DESCS: Record<string, string> = {
    axiom:             'Permet de construire et modifier rapidement le monde avec des outils avancés d’édition (sélection, copie, déplacement, terraformation...).',
    chunkpregenerator: 'Pré-génère les chunks du monde à l’avance pour réduire les ralentissements et accélérer leur chargement en jeu.',
    xraymod:           'Permet de voir à travers les blocs pour repérer facilement les minerais, cavités et structures souterraines. Utile pour repérer les tricheurs.',
    ekcore:            'Mod maison du serveur.',
    spark:             'Analyse les performances du serveur et aide à identifier les sources de lag (TPS, CPU, mémoire, ticks…).',

    distanthorizons:   'Augmente la distance de vue en affichant le terrain lointain sous forme de LOD pour admirer de vastes paysages sans charger tous les chunks.',
    forgematica:       'Permet de sauvegarder, afficher et reproduire des constructions grâce à des plans et outils de placement automatisé.',
    immediatelyfast:   'Optimise le rendu graphique pour améliorer les performances et augmenter les FPS sans modifier l’apparence du jeu.',
    jade:              'Affiche des informations sur les blocs et entités visés (nom, état, contenu, etc.).',
    mousetweaks:       'Améliore la gestion des objets dans les inventaires avec des raccourcis souris pour déplacer, trier et transférer rapidement les items.',
    appleskin:         'Affiche des informations détaillées sur la faim et la saturation, notamment la nourriture restaurée et la faim restante.',
    embeddium:         'Optimise le rendu graphique de Minecraft pour améliorer les performances et augmenter les FPS.',
    ferritecore:       'Réduit l’utilisation de la mémoire RAM de Minecraft pour améliorer les performances et la stabilité du jeu.',
    jei:               'Affiche les objets et recettes disponibles et permet de consulter facilement leur utilisation et leur fabrication.',
    modernfix:         'Optimise Minecraft pour améliorer les performances, réduire l’utilisation de la mémoire et accélérer les temps de chargement.',
    oculus:            'Ajoute le support des shaders sur Minecraft Forge pour améliorer le rendu graphique et profiter d’effets visuels avancés.',
    soundphysics:      'Améliore le réalisme sonore avec des effets de réverbération, d’occlusion et de propagation du son selon l’environnement.'
}

const TIER_DESCRIPTIONS: Record<PerfLevel, string> = {
    low: 'Configuration pensée pour privilégier les performances et limiter l’utilisation des ressources.',
    medium: 'Configuration équilibrée entre performances, fonctionnalités et confort de jeu.',
    high: 'Configuration pensée pour profiter de davantage de fonctionnalités, au prix d’une utilisation plus importante des ressources.',
}

function lookup<T>(table: Record<string, T>, name: string): T | undefined {
    const norm = name.toLowerCase().replace(/[^a-z0-9]/g, '')
    const hit = Object.keys(table)
        .filter(k => norm.startsWith(k))
        .sort((a, b) => b.length - a.length)[0]
    return hit ? table[hit] : undefined
}

function parseModInfo(path: string): { name: string; version: string } {
    const filename = path.split('/').pop() ?? path
    const base     = filename.replace(/\.(jar|zip)$/, '')
    const match    = base.match(/^([A-Za-z][A-Za-z0-9 _-]*?)-(\d+\.\d+.*)$/)
    if (match) {
        const parts = match[2].split('-').filter(p => /^\d/.test(p))
        return { name: match[1], version: parts[parts.length - 1] ?? match[2].split('-')[0] }
    }
    return { name: base, version: '' }
}

function formatSize(bytes: number): string {
    return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}

interface Props {
    /** Compte autorisé à jouer la beta : affiche le sélecteur de modpack. */
    canBeta: boolean
    onProfileCreated: (name: string) => void
    onOpenSettings: () => void
}

export default function ModsPage({ canBeta, onProfileCreated, onOpenSettings }: Props) {
    const [beta,      setBeta]      = useState(false)
    const [mods,      setMods]      = useState<OptionalMod[]>([])
    const [enabled,   setEnabled]   = useState<Set<string>>(new Set())
    const [tiers,     setTiers]     = useState<Record<string, PerfLevel>>({})
    const [profile,   setProfile]   = useState<LaunchProfile | null>(null)
    const [profiles,  setProfiles]  = useState<LaunchProfile[]>([])
    const [counts,    setCounts]    = useState<Record<string, number>>({})
    const [newName,   setNewName]   = useState('')
    const [creating,  setCreating]  = useState(false)
    const [loading,   setLoading]   = useState(true)
    const [collapsed, setCollapsed] = useState(false)

    function handleScroll(e: React.UIEvent<HTMLDivElement>) {
        const el = e.currentTarget
        const overflow = el.scrollHeight - el.clientHeight
        if (!collapsed && el.scrollTop > 40 && overflow > 220) setCollapsed(true)
        else if (collapsed && el.scrollTop < 8) setCollapsed(false)
    }

    useEffect(() => {
        setLoading(true)
        setCollapsed(false)
        const useBeta = canBeta && beta
        // Le canal (profils du jeu ou de la beta) est fixé avant tout le reste :
        // liste des profils, mods activés et catalogue en dépendent.
        // Le catalogue doit être récupéré avant les paliers : c'est modsGetOptional
        // qui met le catalogue en cache côté main, et perfModTiers le relit.
        window.api.profilesSetChannel(useBeta).then(() => window.api.modsGetOptional(useBeta)).then(async files => {
            setMods(files.map(f => ({ path: f.path, size: f.size, ...parseModInfo(f.path) })))
            const [enabledPaths, modTiers, list] = await Promise.all([
                window.api.modsGetEnabled(),
                window.api.perfModTiers(),
                window.api.profilesList(),
            ])
            setEnabled(new Set(enabledPaths))
            setTiers(modTiers)
            applyList(list)
            setLoading(false)
        }).catch(() => setLoading(false))
    }, [beta, canBeta])

    // Quitter l'onglet ramène le canal sur le jeu : les paramètres et le reste du
    // launcher éditent toujours les profils du jeu, jamais ceux de la beta par mégarde.
    useEffect(() => () => { window.api.profilesSetChannel(false) }, [])

    function applyList(list: { profiles: LaunchProfile[]; activeId: string; modCounts: Record<string, number> }) {
        setProfiles(list.profiles)
        setCounts(list.modCounts)
        setProfile(list.profiles.find(p => p.id === list.activeId) ?? null)
    }

    async function refresh() {
        const [enabledPaths, list] = await Promise.all([
            window.api.modsGetEnabled(),
            window.api.profilesList(),
        ])
        setEnabled(new Set(enabledPaths))
        applyList(list)
    }

    /** Change de profil sans quitter la page : la liste se recharge sur place. */
    async function selectProfile(id: string) {
        if (id === profile?.id) return
        await window.api.profilesSetActive(id)
        await refresh()
    }

    /**
     * Crée un profil personnalisé depuis l'actif. Pratique ici : on prépare un
     * profil vierge avant de composer sa liste de mods, plutôt que de laisser la
     * dérivation automatique le nommer à notre place.
     */
    async function createProfile() {
        const name = newName.trim()
        if (!name) return

        await window.api.profilesCreate(name, profile?.id ?? '')
        setNewName('')
        setCreating(false)
        await refresh()
        onProfileCreated(name)
    }

    /**
     * Enregistre une sélection. Le main process crée un profil personnalisé si le
     * profil actif est un palier intégré - on le signale plutôt que de laisser le
     * joueur découvrir un nouveau profil sans explication.
     */
    async function persist(paths: string[]) {
        try {
            const res = await window.api.modsSetEnabled(paths)
            applyList(await window.api.profilesList())
        } catch { /* silencieux */ }
    }

    function toggle(path: string) {
        setEnabled(prev => {
            const next = new Set(prev)

            if (next.has(path)) {
                next.delete(path)
            } else {
                next.add(path)
            }

            persist([...next])
            return next
        })
    }

    // Ne touchent que les mods du catalogue affiché : la sélection est commune aux
    // deux modpacks, les mods de l'autre canal doivent rester tels quels.
    function enableAll() {
        const next = new Set([...enabled, ...mods.map(m => m.path)])
        setEnabled(next)
        persist([...next])
    }

    function disableAll() {
        const shown = new Set(mods.map(m => m.path))
        const next  = new Set([...enabled].filter(p => !shown.has(p)))
        setEnabled(next)
        persist([...next])
    }

    return (
        <div className="mods">
            <div className={`mods__header${collapsed ? ' mods__header--collapsed' : ''}`}>
                <div className="mods__title-row">
                    <h1 className="mods__title">Mods Optionnels</h1>
                    {!loading && (
                        <span className="mods__count">
                            {mods.filter(m => enabled.has(m.path)).length}/{mods.length} actifs
                        </span>
                    )}
                    {canBeta && collapsed && (
                        <span className="mods__pack-chip">{beta ? CHANNELS.beta.label : CHANNELS.game.label}</span>
                    )}
                </div>
                <p className="mods__subtitle">
                    Choisissez les mods optionnels que vous voulez avoir ou non en jeu.
                </p>
                <div className="mods__extras">
                    <div className="mods__extras-inner">
                        {canBeta && (
                            <div className="mods__profiles">
                                <span className="mods__profiles-label">Modpack</span>
                                <div className="mods__profiles-list">
                                    <button className={`profile-chip ${!beta ? 'profile-chip--active' : ''}`} onClick={() => setBeta(false)}>
                                        {CHANNELS.game.label}
                                    </button>
                                    <button className={`profile-chip ${beta ? 'profile-chip--active' : ''}`} onClick={() => setBeta(true)}>
                                        {CHANNELS.beta.label}
                                    </button>
                                </div>
                            </div>
                        )}
                        {!loading && profiles.length > 0 && (
                            <div className="mods__profiles">
                                <span className="mods__profiles-label">Profil</span>
                                <div className="mods__profiles-list">
                                    {profiles.map(p => (
                                        <button
                                            key={p.id}
                                            className={`profile-chip ${profile?.id === p.id ? 'profile-chip--active' : ''}`}
                                            onClick={() => selectProfile(p.id)}
                                            title={
                                                p.builtin
                                                    ? `${TIER_DESCRIPTIONS[p.perfLevel]} Modifier les mods créera automatiquement une configuration personnalisée.`
                                                    : 'Configuration personnalisée. Les mods que tu actives ou désactives sont enregistrés dans cette configuration.'
                                            }
                                        >
                                            {p.name}
                                            <span className="profile-chip__meta">{counts[p.id] ?? 0}</span>
                                        </button>
                                    ))}
                                    {creating ? (
                                        <span className="mods__profiles-actions">
                                            <input
                                                className="mods__profiles-input"
                                                placeholder="Nom du profil..."
                                                value={newName}
                                                onChange={e => setNewName(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') createProfile()
                                                    if (e.key === 'Escape') {
                                                        setCreating(false)
                                                        setNewName('')
                                                    }
                                                }}
                                                autoFocus
                                            />

                                            <button
                                                className="profile-chip"
                                                onClick={createProfile}
                                                disabled={!newName.trim()}
                                            >Créer</button>

                                            <button
                                                className="profile-chip"
                                                onClick={() => {
                                                    setCreating(false)
                                                    setNewName('')
                                                }}
                                            >Annuler</button>
                                        </span>
                                    ) : (
                                        <span className="mods__profiles-actions">
                                            <button
                                                className="profile-chip mods__profiles-add"
                                                onClick={() => setCreating(true)}
                                            >
                                                <Plus size={13} strokeWidth={2} />
                                                Nouveau
                                            </button>

                                            <button
                                                className="profile-chip mods__profiles-manage"
                                                onClick={onOpenSettings}
                                                title="Gérer les profils dans les paramètres"
                                            >
                                                <Settings size={13} strokeWidth={2} />
                                                Gérer les profils
                                            </button>
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                        {profile && (
                            <p className="mods__profile">
                                {canBeta && beta && 'Profils de la beta, séparés de ceux du jeu. '}
                                {profile.builtin
                                    ? `${TIER_DESCRIPTIONS[profile.perfLevel]} Modifier les mods créera automatiquement une configuration personnalisée.`
                                    : 'Configuration personnalisée. Les mods que tu actives ou désactives sont enregistrés dans cette configuration.'}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            <div className="mods__list" onScroll={handleScroll}>
                {loading && <p className="mods__empty">Chargement…</p>}
                {!loading && mods.length === 0 && (
                    <p className="mods__empty">Aucun mod optionnel disponible.</p>
                )}

                {!loading && (() => {
                    const adminMods    = mods.filter(m => m.path.startsWith('modadmin/'))
                    const optionalMods = mods.filter(m => !m.path.startsWith('modadmin/'))

                    const renderMod = (mod: OptionalMod, isAdmin: boolean) => {
                        const on          = enabled.has(mod.path)
                        const displayName = lookup(MOD_NAMES, mod.name) ?? mod.name
                        const icon        = lookup(MOD_ICONS, mod.name) ?? DEFAULT_ICON
                        const desc        = lookup(MOD_DESCS, mod.name) ?? (isAdmin
                            ? 'Mod réservé aux administrateurs.'
                            : 'Mod optionnel - cliquez pour activer ou désactiver.')
                        return (
                            <div key={mod.path} className={`mod-row ${on ? 'mod-row--on' : ''} ${isAdmin ? 'mod-row--admin' : ''}`}>
                                <div className="mod-row__icon">
                                    {icon}
                                </div>
                                <div className="mod-row__info">
                                    <div className="mod-row__name-line">
                                        <span className="mod-row__name">{displayName}</span>
                                        {isAdmin && <span className="mod-row__admin-badge">ADMIN</span>}
                                        {!isAdmin && tiers[mod.path] && (
                                            <span className={`mod-row__tier mod-row__tier--${tiers[mod.path]}`}>
                                                {TIER_LABELS[tiers[mod.path]]}
                                            </span>
                                        )}
                                        {mod.version && <span className="mod-row__version">v{mod.version}</span>}
                                        <span className="mod-row__size">{formatSize(mod.size)}</span>
                                    </div>
                                    <p className="mod-row__desc">{desc}</p>
                                </div>
                                <button
                                    role="switch"
                                    aria-checked={on}
                                    className={`mod-switch ${on ? 'mod-switch--on' : ''}`}
                                    onClick={() => toggle(mod.path)}
                                >
                                    <span className="mod-switch__label">{on ? 'Activé' : 'Désactivé'}</span>
                                    <span className="mod-switch__track" />
                                </button>
                            </div>
                        )
                    }

                    return (
                        <>
                            {adminMods.length > 0 && (
                                <>
                                    <p className="mods__section-label">Mods Admin</p>
                                    {adminMods.map(m => renderMod(m, true))}
                                    {optionalMods.length > 0 && <p className="mods__section-label">Mods Optionnels</p>}
                                </>
                            )}
                            {optionalMods.map(m => renderMod(m, false))}
                        </>
                    )
                })()}
            </div>

            <div className="mods__footer">
                <span>
                    <TriangleAlert size={16} strokeWidth={2} className="mods__footer-warning"/>
                    Changements pris en compte au prochain lancement.
                </span>
                {!loading && mods.length > 0 && (
                    <div className="mods__footer-actions">
                        <button className="mods__btn" onClick={enableAll}>Tout activer</button>
                        <button className="mods__btn" onClick={disableAll}>Tout désactiver</button>
                    </div>
                )}
            </div>
        </div>
    )
}
