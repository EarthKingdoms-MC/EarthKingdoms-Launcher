import { useEffect, useState } from 'react'

export interface NewsItem {
  title: string
  date:  string
  tag:   string
  desc:  string
  img:   string | null
  url:   string
}

const BASE = 'https://earthkingdoms-mc.fr'

function toAbsolute(src: string): string {
  if (!src) return ''
  if (src.startsWith('http')) return src
  return src.startsWith('/') ? `${BASE}${src}` : `${BASE}/${src}`
}

export function useNews(): { news: NewsItem[]; loading: boolean } {
  const [news,    setNews]    = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.newsLoad().then(html => {
      if (!html) { setLoading(false); return }

      const doc = new DOMParser().parseFromString(html, 'text/html')

      // Structure réelle du site EK : <a class="news-card"> avec .news-content
      let cards = Array.from(doc.querySelectorAll('.news-card'))
      if (!cards.length) cards = Array.from(doc.querySelectorAll('.card'))

      const items: NewsItem[] = []

      for (const card of cards) {
        // Filtrer les articles masqués
        if (card.classList.contains('hidden-article') ||
            (card as HTMLElement).style.display === 'none' ||
            card.getAttribute('data-visible') === 'false') continue

        const content = card.querySelector('.news-content')
        const titleEl = (content ?? card).querySelector('h2, h3')
        const dateEl  = (content ?? card).querySelector('.date, time')
        const tagEl   = (content ?? card).querySelector('.tag, .category, .badge, .type')
        // Le premier <p> sans classe date = description
        const paragraphs = Array.from((content ?? card).querySelectorAll('p'))
        const descEl = paragraphs.find(p => !p.classList.contains('date'))
        const imgEl  = card.querySelector('img')

        const title = titleEl?.textContent?.trim() ?? 'Sans titre'
        const date  = dateEl?.textContent?.trim()  ?? ''
        const tag   = tagEl?.textContent?.trim()   ?? 'Actualité'
        const desc  = descEl?.textContent?.trim()  ?? ''

        let url = ''
        const anchor = card.tagName === 'A' ? (card as HTMLAnchorElement) : card.querySelector('a')
        if (anchor?.href) url = toAbsolute(anchor.getAttribute('href') ?? anchor.href)

        let img: string | null = null
        if (imgEl) {
          const src = imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || ''
          if (src) img = toAbsolute(src)
        }

        items.push({ title, date, tag, desc, img, url })
      }

      setNews(items)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  return { news, loading }
}
