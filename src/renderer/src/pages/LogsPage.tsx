import { useState, useEffect, useRef } from 'react'
import './LogsPage.css'

interface LogEntry {
  time:  string
  level: 'info' | 'warn' | 'error'
  msg:   string
}

function now(): string {
  return new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function parseLine(raw: string): LogEntry {
  const timeMatch = raw.match(/\[(\d{2}:\d{2}:\d{2})\]/)
  const time = timeMatch ? timeMatch[1] : now()

  const upper = raw.toUpperCase()
  const level: LogEntry['level'] =
    upper.includes('/ERROR]') || upper.includes('[ERROR') ? 'error' :
    upper.includes('/WARN]')  || upper.includes('[WARN')  ? 'warn'  : 'info'

  // Ne garde que le message (supprime préfixe MC [HH:MM:SS] [thread/LEVEL]: )
  const msgMatch = raw.match(/^\[\d{2}:\d{2}:\d{2}\]\s+\[[^\]]+\]:\s+(.*)$/)
  const msg = msgMatch ? msgMatch[1] : raw

  return { time, level, msg }
}

export default function LogsPage() {
  const [logs,       setLogs]       = useState<LogEntry[]>([
    { time: now(), level: 'info', msg: 'Launcher prêt — en attente de lancement.' }
  ])
  const [autoScroll, setAutoScroll] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll
  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, autoScroll])

  // Charge les logs déjà bufferisés côté main (arrivés avant le montage du composant)
  useEffect(() => {
    window.api.logsGetAll().then(lines => {
      if (lines.length === 0) return
      const entries = lines.flatMap(l => l.split('\n').filter(s => s.trim()).map(parseLine))
      setLogs(prev => [...prev, ...entries])
    })
  }, [])

  // Abonnement aux nouveaux logs Minecraft
  useEffect(() => {
    const onLog = (data: { line: string }) => {
      const lines   = data.line.split('\n').filter(l => l.trim())
      const entries = lines.map(parseLine)
      setLogs(prev => [...prev, ...entries])
    }

    window.api.on('launch:log', onLog as (a: unknown) => void)
    return () => window.api.off('launch:log', onLog as (a: unknown) => void)
  }, [])

  function handleClear() {
    setLogs([{ time: now(), level: 'info', msg: 'Console effacée.' }])
  }

  function handleCopy() {
    const text = logs.map(l => `[${l.time}] [${l.level.toUpperCase()}] ${l.msg}`).join('\n')
    navigator.clipboard.writeText(text).catch(() => {})
  }

  return (
    <div className="logs">
      <div className="logs__toolbar">
        <h1 className="logs__title">Logs</h1>
        <label className="logs__autoscroll">
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
          Auto-scroll
        </label>
        <button className="btn-secondary" onClick={handleCopy}>Copier</button>
        <button className="btn-secondary" onClick={handleClear}>Effacer</button>
        <button className="btn-secondary" onClick={() => window.api.logsOpenDir()}>Ouvrir dossier</button>
      </div>

      <div className="logs__console">
        {logs.map((l, i) => (
          <div key={i} className={`logs__line logs__line--${l.level}`}>
            <span className="logs__time">{l.time}</span>
            <span className={`logs__level logs__level--${l.level}`}>{l.level.toUpperCase()}</span>
            <span className="logs__msg">{l.msg}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
