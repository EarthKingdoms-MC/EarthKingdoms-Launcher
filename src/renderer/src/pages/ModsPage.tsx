import { useState, useEffect } from 'react'
import './ModsPage.css'

interface OptionalMod {
  path:    string
  size:    number
  name:    string
  version: string
}

const MOD_ICONS: Record<string, JSX.Element> = {
  jade: (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="13" rx="2"/>
      <path d="M8 21h8M12 17v4"/>
      <line x1="12" y1="8" x2="12" y2="8.1" strokeWidth="2.5"/>
      <line x1="12" y1="11" x2="12" y2="14"/>
    </svg>
  ),
}

const DEFAULT_ICON = (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
    <path d="M2 17l10 5 10-5"/>
    <path d="M2 12l10 5 10-5"/>
  </svg>
)

const MOD_DESCS: Record<string, string> = {
  jade: 'Affiche des infos sur les blocs et entités en regardant vers eux (nom, HP, biome…)',
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

export default function ModsPage() {
  const [mods,    setMods]    = useState<OptionalMod[]>([])
  const [enabled, setEnabled] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      window.api.modsGetOptional(),
      window.api.modsGetEnabled(),
      window.api.storeGet('optionalModsConfigured'),
    ]).then(([files, enabledPaths, configured]) => {
      const parsed = files.map(f => ({ path: f.path, size: f.size, ...parseModInfo(f.path) }))
      setMods(parsed)

      if (!configured && parsed.length > 0) {
        // Première ouverture : activer tous les mods par défaut
        const allPaths = parsed.map(m => m.path)
        setEnabled(new Set(allPaths))
        window.api.modsSetEnabled(allPaths)
        window.api.storeSet('optionalModsConfigured', true)
      } else {
        setEnabled(new Set(enabledPaths as string[]))
      }

      setLoading(false)
    })
  }, [])

  function toggle(path: string) {
    setEnabled(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      window.api.modsSetEnabled([...next])
      return next
    })
  }

  function enableAll() {
    const allPaths = mods.map(m => m.path)
    setEnabled(new Set(allPaths))
    window.api.modsSetEnabled(allPaths)
  }

  function disableAll() {
    setEnabled(new Set())
    window.api.modsSetEnabled([])
  }

  return (
    <div className="mods">
      <div className="mods__header">
        <div className="mods__title-row">
          <h1 className="mods__title">Mods Optionnels</h1>
          {!loading && (
            <span className="mods__count">{enabled.size}/{mods.length} actifs</span>
          )}
        </div>
        <p className="mods__subtitle">
          Activés au prochain lancement — le modpack principal n'est pas modifiable ici.
        </p>
      </div>

      <div className="mods__list">
        {loading && <p className="mods__empty">Chargement…</p>}
        {!loading && mods.length === 0 && (
          <p className="mods__empty">Aucun mod optionnel disponible.</p>
        )}

        {mods.map(mod => {
          const key   = mod.name.toLowerCase().replace(/\s+/g, '')
          const on    = enabled.has(mod.path)
          const desc  = MOD_DESCS[key] ?? 'Mod optionnel — cliquez pour activer ou désactiver.'
          return (
            <div key={mod.path} className={`mod-row ${on ? 'mod-row--on' : ''}`}>
              {/* Icône */}
              <div className="mod-row__icon">
                {MOD_ICONS[key] ?? DEFAULT_ICON}
              </div>

              {/* Infos */}
              <div className="mod-row__info">
                <div className="mod-row__name-line">
                  <span className="mod-row__name">{mod.name}</span>
                  {mod.version && (
                    <span className="mod-row__version">v{mod.version}</span>
                  )}
                  <span className="mod-row__size">{formatSize(mod.size)}</span>
                </div>
                <p className="mod-row__desc">{desc}</p>
              </div>

              {/* Toggle bouton style Minecraft */}
              <button
                className={`mod-toggle ${on ? 'mod-toggle--on' : 'mod-toggle--off'}`}
                onClick={() => toggle(mod.path)}
              >
                {on ? 'ACTIVÉ' : 'DÉSACTIVÉ'}
              </button>
            </div>
          )
        })}
      </div>

      <div className="mods__footer">
        <span>Changements pris en compte au prochain lancement.</span>
        {!loading && mods.length > 0 && (
          <div className="mods__footer-actions">
            <button className="mod-toggle mod-toggle--on" onClick={enableAll}>TOUT ACTIVER</button>
            <button className="mod-toggle mod-toggle--off" onClick={disableAll}>TOUT DÉSACTIVER</button>
          </div>
        )}
      </div>
    </div>
  )
}
