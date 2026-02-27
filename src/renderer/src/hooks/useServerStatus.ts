import { useEffect, useState, useRef } from 'react'
import { ServerStatus } from './useSkin'

export type Status = (ServerStatus & { online: true }) | { online: false }

const POLL_INTERVAL = 60_000 // 60 secondes

export function useServerStatus(): { status: Status; loading: boolean } {
  const [status,  setStatus]  = useState<Status>({ online: false })
  const [loading, setLoading] = useState(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function fetch() {
    try {
      const s = await window.api.serverStatus()
      setStatus(s as Status)
    } catch {
      setStatus({ online: false })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetch()
    timerRef.current = setInterval(fetch, POLL_INTERVAL)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  return { status, loading }
}
