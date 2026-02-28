import { useEffect, useState } from 'react'
import './PatchNotesPage.css'

interface PatchNote {
  version: string
  date:    string
  entries: string[]
}

function parsePatchNotes(html: string): PatchNote[] {
  const doc   = new DOMParser().parseFromString(html, 'text/html')
  const items: PatchNote[] = []

  const cards = Array.from(
    doc.querySelectorAll('.patchnote-card, .patchnote, .changelog-entry, .patch-card, article')
  )

  for (const card of cards) {
    const versionEl = card.querySelector('h1, h2, h3, .version, .patch-version')
    const dateEl    = card.querySelector('.date, time, .patch-date')
    const listEls   = Array.from(card.querySelectorAll('li, .entry, .change, .changelog-line'))

    const version = versionEl?.textContent?.trim() ?? ''
    const date    = dateEl?.textContent?.trim()    ?? ''
    const entries = listEls.map(el => el.textContent?.trim() ?? '').filter(Boolean)

    if (version || entries.length) items.push({ version, date, entries })
  }

  return items
}

export default function PatchNotesPage() {
  const [notes,   setNotes]   = useState<PatchNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    window.api.patchnotesLoad().then(html => {
      if (!html) { setError(true); setLoading(false); return }
      const parsed = parsePatchNotes(html)
      setNotes(parsed)
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

        {!loading && (error || notes.length === 0) && (
          <div className="patchnotes__state">
            <div className="patchnotes__state-icon">◈</div>
            <div className="patchnotes__state-title">Bientôt disponible</div>
            <div className="patchnotes__state-sub">
              Les patch notes EarthKingdoms seront publiées ici après chaque mise à jour du serveur.
            </div>
          </div>
        )}

        {!loading && !error && notes.map((note, i) => (
          <div key={i} className="patchnotes__entry">
            <div className="patchnotes__entry-header">
              {note.version && <span className="patchnotes__entry-version">{note.version}</span>}
              {note.date    && <span className="patchnotes__entry-date">{note.date}</span>}
            </div>
            {note.entries.length > 0 && (
              <ul className="patchnotes__entry-list">
                {note.entries.map((e, j) => (
                  <li key={j} className="patchnotes__entry-item">{e}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
