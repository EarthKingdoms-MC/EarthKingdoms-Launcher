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

const TAG_LABELS: Record<string, string> = {
  'actualite':  'Actualité',
  'patch-note': 'Patch Note',
  'evenement':  'Événement',
}

interface ApiArticle {
  title:    string
  type:     string
  excerpt:  string
  imageUrl: string | null
  dateFr:   string
  url:      string
}

export function useNews(): { news: NewsItem[]; loading: boolean } {
  const [news,    setNews]    = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.newsLoad().then(json => {
      if (!json) { setLoading(false); return }
      try {
        const data = JSON.parse(json) as ApiArticle[]
        const items: NewsItem[] = data.map(a => ({
          title: a.title,
          date:  a.dateFr,
          tag:   TAG_LABELS[a.type] ?? a.type,
          desc:  a.excerpt ?? '',
          img:   a.imageUrl ?? null,
          url:   a.url.startsWith('http') ? a.url : `${BASE}${a.url}`,
        }))
        setNews(items)
      } catch { /* JSON invalide */ }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  return { news, loading }
}
