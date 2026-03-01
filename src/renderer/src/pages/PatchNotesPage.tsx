import { useEffect, useState } from 'react'
import './PatchNotesPage.css'

interface PatchCard {
  title:   string
  date:    string
  excerpt: string
  url:     string
}

function parsePatchNotes(json: string): PatchCard[] {
  try {
    const data = JSON.parse(json) as Array<{
      title: string; dateFr: string; excerpt: string; url: string
    }>
    return data
      .map(a => ({
        title:   a.title,
        date:    a.dateFr,
        excerpt: a.excerpt ?? '',
        url:     a.url.startsWith('http') ? a.url : `https://earthkingdoms-mc.fr${a.url}`,
      }))
      .filter(c => c.title)
  } catch {
    return []
  }
}

export default function PatchNotesPage() {
  const [cards,   setCards]   = useState<PatchCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    window.api.patchnotesLoad().then(html => {
      if (!html) { setError(true); setLoading(false); return }
      const parsed = parsePatchNotes(html)
      setCards(parsed)
      setLoading(false)
    }).catch(() => { setError(true); setLoading(false) })
  }, [])

  return (
    <div className="patchnotes">
      <div className="patchnotes__content">
        <div className="patchnotes__page-label">Patch Notes</div>

        {loading && (
          <div className="patchnotes__state">
            <div className="patchnotes__state-icon patchnotes__state-icon--spin">◈</div>
            <span className="patchnotes__state-text">Chargement…</span>
          </div>
        )}

        {!loading && (error || cards.length === 0) && (
          <div className="patchnotes__state">
            <div className="patchnotes__state-icon">◈</div>
            <div className="patchnotes__state-title">Bientôt disponible</div>
            <div className="patchnotes__state-sub">
              Les patch notes EarthKingdoms seront publiées ici après chaque mise à jour du serveur.
            </div>
          </div>
        )}

        {!loading && !error && cards.length > 0 && (
          <div className="patchnotes__cards">
            {cards.map((card, i) => (
              <div
                key={i}
                className="patchnotes__card"
                onClick={() => card.url && window.api.openExternal(card.url)}
                style={{ cursor: card.url ? 'pointer' : 'default' }}
              >
                <div className="patchnotes__card-header">
                  <span className="patchnotes__card-title">{card.title}</span>
                  {card.date && <span className="patchnotes__card-date">{card.date}</span>}
                </div>
                {card.excerpt && (
                  <p className="patchnotes__card-excerpt">{card.excerpt}</p>
                )}
                {card.url && (
                  <span className="patchnotes__card-link">Lire sur le site →</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
