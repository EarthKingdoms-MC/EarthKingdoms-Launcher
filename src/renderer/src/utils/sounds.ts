// ── Sons UI — HTMLAudioElement pré-chargé + préchauffage pipeline ──────────
//
// Stratégie anti-latence :
//   1. Pool de 2 instances par son, chargées au démarrage (preload:'auto')
//   2. Préchauffage pipeline : chaque instance est jouée à vol 0 au boot
//      (autoplay activé dans main via --autoplay-policy=no-user-gesture-required)
//   3. Pour button_click / close / notif : démarrage à duration/2
//      → saute l'attaque silencieuse du début → son immédiat
//   4. Pour play (levelup) : démarrage à 0 (son déjà très réactif)

let enabled = true
export function setSoundEnabled(v: boolean): void { enabled = v }
export function isSoundEnabled(): boolean { return enabled }

const SOUND_FILES = ['button_click.ogg', 'play.ogg', 'close.ogg', 'notif.ogg'] as const
type SoundFile = typeof SOUND_FILES[number]

// Sons pour lesquels on saute la première moitié (attaque silencieuse)
const SKIP_HALF = new Set<SoundFile>(['button_click.ogg', 'close.ogg', 'notif.ogg'])

const _pool:        Partial<Record<SoundFile, [HTMLAudioElement, HTMLAudioElement]>> = {}
const _poolIdx:     Partial<Record<SoundFile, 0 | 1>>                               = {}
const _startOffset: Partial<Record<SoundFile, number>>                              = {}

// ── Initialisation ────────────────────────────────────────────────────────

;(function init() {
  for (const file of SOUND_FILES) {
    try {
      const make = (): HTMLAudioElement => {
        const a = new Audio(`./sounds/${file}`)
        a.preload = 'auto'

        // Calcule l'offset de démarrage dès que les métadonnées sont disponibles
        a.addEventListener('loadedmetadata', () => {
          if (SKIP_HALF.has(file) && isFinite(a.duration) && a.duration > 0) {
            _startOffset[file] = a.duration / 2
          }
        }, { once: true })

        a.load()
        return a
      }

      const a0 = make()
      const a1 = make()

      // Préchauffage : joué en silence pour initialiser la pipeline audio OS
      const warm = (a: HTMLAudioElement) => {
        a.volume = 0.001
        a.play()
          .then(() => {
            a.pause()
            a.currentTime = _startOffset[file] ?? 0
            a.volume = 1
          })
          .catch(() => {})
      }
      warm(a0)
      warm(a1)

      _pool[file]    = [a0, a1]
      _poolIdx[file] = 0
    } catch { /* son indisponible */ }
  }
})()

// ── Lecture via le pool ───────────────────────────────────────────────────

function playBuf(file: SoundFile, vol: number): void {
  const pool = _pool[file]
  if (!pool) return
  try {
    const idx   = _poolIdx[file] ?? 0
    const audio = pool[idx]
    _poolIdx[file]    = idx === 0 ? 1 : 0
    audio.volume      = Math.max(0, Math.min(1, vol))
    audio.currentTime = _startOffset[file] ?? 0   // saute l'attaque silencieuse
    audio.play().catch(() => {})
  } catch { }
}

// ── API publique ──────────────────────────────────────────────────────────

export function playClick(): void { try { if (enabled) playBuf('button_click.ogg', 0.65) } catch { } }
export function playPlay():  void { try { if (enabled) playBuf('play.ogg',         0.80) } catch { } }
export function playClose(): void { try { if (enabled) playBuf('close.ogg',        0.60) } catch { } }
export function playNotif(): void { try { if (enabled) playBuf('notif.ogg',        0.70) } catch { } }
