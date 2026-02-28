import { useEffect, useState } from 'react'
import './PatchNotesPage.css'

interface PatchCard {
  title:   string
  date:    string
  excerpt: string
  url:     string
}

function parsePatchNotes(html: string): PatchCard[] {
  const doc   = new DOMParser().parseFromString(html, 'text/html')
  const cards = Array.from(doc.querySelectorAll('.news-card'))
  const items: PatchCard[] = []

  for (const card of cards) {
    // Titre : h1/h2/h3 ou .title, .news-title, .card-title
    const titleEl  = card.querySelector('h1, h2, h3, .title, .news-title, .card-title')
    // Date : .date, time, [class*="date"]
    const dateEl   = card.querySelector('.date, time, [class*="date"]')
    // Extrait : premier <p> de .news-content, sinon tout le texte hors titre/date
    const content  = card.querySelector('.news-content, .card-content')
    const excerptEl = content?.querySelector('p') ?? card.querySelector('p')
    // Lien vers l'article complet
    const linkEl   = card.querySelector('a[href*="/news/"]') ?? card.closest('a[href*="/news/"]')
    const href     = linkEl?.getAttribute('href') ?? ''

    const title   = titleEl?.textContent?.trim()   ?? ''
    const date    = dateEl?.textContent?.trim()    ?? ''
    const excerpt = excerptEl?.textContent?.trim() ?? ''
    const url     = href.startsWith('http')
      ? href
      : `https://earthkingdoms-mc.fr${href}`

    if (title) items.push({ title, date, excerpt, url })
  }

  return items
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
