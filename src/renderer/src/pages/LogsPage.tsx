import { useState, useEffect, useRef } from 'react'
import './LogsPage.css'

interface LogEntry {
  time:  string
  level: 'info' | 'warn' | 'error'
  msg:   string
}

const CRASH_PATTERNS: { re: RegExp; msg: string }[] = [
  { re: /OutOfMemoryError/i,                                    msg: 'Mémoire insuffisante (OutOfMemoryError) — augmente la RAM dans Paramètres.' },
  { re: /invalid session/i,                                     msg: 'Session invalide — reconnecte-toi dans le launcher.' },
  { re: /Terminating due to java\.lang/i,                       msg: 'Crash JVM fatal détecté.' },
  { re: /EXCEPTION_ACCESS_VIOLATION/i,                          msg: 'Crash mémoire natif (ACCESS_VIOLATION).' },
  { re: /A fatal error has been detected by the Java Runtime/i, msg: 'Erreur fatale JVM (hs_err).' },
]

function detectCrash(msg: string): string | null {
  for (const p of CRASH_PATTERNS) if (p.re.test(msg)) return p.msg
  return null
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
  const [logs,          setLogs]          = useState<LogEntry[]>([
    { time: now(), level: 'info', msg: 'Launcher prêt — en attente de lancement.' }
  ])
  const [autoScroll,    setAutoScroll]    = useState(true)
  const [crash,         setCrash]         = useState<string | null>(null)
  const [showBugModal,  setShowBugModal]  = useState(false)
  const [bugScreenshot, setBugScreenshot] = useState<string | null>(null)
  const [bugDesc,       setBugDesc]       = useState('')
  const [bugSending,    setBugSending]    = useState(false)
  const [appVersion,    setAppVersion]    = useState('?')
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll
  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, autoScroll])

  // Charge les logs et la version au montage
  useEffect(() => {
    window.api.logsGetAll().then(lines => {
      if (lines.length === 0) return
      const entries = lines.flatMap(l => l.split('\n').filter(s => s.trim()).map(parseLine))
      setLogs(prev => [...prev, ...entries])
    })
    window.api.appVersion().then(v => setAppVersion(v)).catch(() => {})
  }, [])

  // Abonnement aux nouveaux logs Minecraft + détection crash
  useEffect(() => {
    const onLog = (data: { line: string }) => {
      const lines   = data.line.split('\n').filter(l => l.trim())
      const entries = lines.map(parseLine)
      setLogs(prev => [...prev, ...entries])
      for (const e of entries) {
        const c = detectCrash(e.msg)
        if (c) { setCrash(c); break }
      }
    }

    const onClose = (data: { code: number }) => {
      if (data.code !== 0) {
        setCrash(`Minecraft s'est fermé de manière inattendue (code ${data.code}).`)
      }
    }

    const onError = (data: { message: string }) => {
      setCrash(`Erreur de lancement : ${data.message}`)
    }

    const onState = (data: { running: boolean }) => {
      if (data.running) setCrash(null)  // nouveau lancement → reset crash
    }

    window.api.on('launch:log',   onLog   as (a: unknown) => void)
    window.api.on('launch:close', onClose as (a: unknown) => void)
    window.api.on('launch:error', onError as (a: unknown) => void)
    window.api.on('launch:state', onState as (a: unknown) => void)
    return () => {
      window.api.off('launch:log',   onLog   as (a: unknown) => void)
      window.api.off('launch:close', onClose as (a: unknown) => void)
      window.api.off('launch:error', onError as (a: unknown) => void)
      window.api.off('launch:state', onState as (a: unknown) => void)
    }
  }, [])

  function handleClear() {
    setLogs([{ time: now(), level: 'info', msg: 'Console effacée.' }])
  }

  function handleCopy() {
    const text = logs.map(l => `[${l.time}] [${l.level.toUpperCase()}] ${l.msg}`).join('\n')
    navigator.clipboard.writeText(text).catch(() => {})
  }

  async function openBugModal() {
    setBugDesc('')
    setBugSending(false)
    setBugScreenshot(null)
    setShowBugModal(true)
    try {
      const shot = await window.api.bugCaptureScreen()
      setBugScreenshot(shot)
    } catch { /* pas de screenshot */ }
  }

  function handleSendBug() {
    if (!bugDesc.trim() || bugSending) return
    setBugSending(true)
    const last30 = logs.slice(-30).map(l => `[${l.time}] [${l.level.toUpperCase()}] ${l.msg}`).join('\n')
    const rawBody = [
      `## Description\n${bugDesc.trim()}`,
      `## Informations\n- Version launcher : v${appVersion}\n- Plateforme : ${navigator.userAgent}`,
      `## Logs (dernières 30 lignes)\n\`\`\`\n${last30}\n\`\`\``,
    ].join('\n\n')
    const body = rawBody.slice(0, 4000)
    const title = encodeURIComponent(`Bug report v${appVersion}`)
    const url = `https://github.com/EarthKingdoms-MC/EarthKingdoms-Launcher/issues/new?title=${title}&body=${encodeURIComponent(body)}`
    window.api.openExternal(url)
    setShowBugModal(false)
    setBugSending(false)
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
        <button className="btn-secondary logs__bug-btn" onClick={openBugModal}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          Signaler un bug
        </button>
      </div>

      {crash && (
        <div className="logs__crash-banner">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>{crash}</span>
          <button className="logs__crash-dismiss" onClick={() => setCrash(null)} title="Fermer">✕</button>
        </div>
      )}

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

      {showBugModal && (
        <div className="logs__bug-backdrop">
          <div className="logs__bug-modal">
            <div className="logs__bug-header">
              <span className="logs__bug-title">Signaler un bug</span>
              <button
                className="logs__bug-close"
                data-sound="close"
                onClick={() => setShowBugModal(false)}
                title="Fermer"
              >✕</button>
            </div>

            {bugScreenshot && (
              <div className="logs__bug-screenshot">
                <img src={bugScreenshot} alt="Screenshot" />
              </div>
            )}

            <textarea
              className="logs__bug-desc"
              placeholder="Décris le bug : que faisais-tu ? Qu'as-tu observé ?"
              value={bugDesc}
              onChange={e => setBugDesc(e.target.value)}
              rows={4}
              autoFocus
            />

            <div className="logs__bug-preview-label">Aperçu des logs (30 dernières lignes)</div>
            <div className="logs__bug-preview">
              {logs.slice(-30).map((l, i) => (
                <div key={i} className={`logs__bug-log logs__bug-log--${l.level}`}>
                  [{l.time}] [{l.level.toUpperCase()}] {l.msg}
                </div>
              ))}
            </div>

            <div className="logs__bug-actions">
              <button
                className="btn-secondary"
                data-sound="close"
                onClick={() => setShowBugModal(false)}
              >Annuler</button>
              <button
                className="btn-secondary logs__bug-send"
                onClick={handleSendBug}
                disabled={!bugDesc.trim() || bugSending}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
                </svg>
                Ouvrir sur GitHub
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
