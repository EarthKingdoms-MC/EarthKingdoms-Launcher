import { app } from 'electron'
import { cpus, totalmem } from 'os'
import type { PerfLevel } from './perfProfiles'

// ─────────────────────────────────────────────────────────────────────────────
// Détection matérielle
//
// Sert une seule fois : proposer un palier de départ au premier démarrage.
// Ce n'est volontairement pas un benchmark - on ne fait pas tourner de charge
// de test, on lit ce que l'OS et Chromium exposent déjà. Le résultat est une
// suggestion présentée au joueur, jamais une décision imposée.
// ─────────────────────────────────────────────────────────────────────────────

export interface HardwareInfo {
  cpuCores:    number
  cpuModel:    string
  totalRamGB:  number
  gpuName:     string | null
  gpuKind:     'dedicated' | 'integrated' | 'unknown'
  score:       number      // 0-9
  recommended: PerfLevel
}

// Identifiants PCI des fondeurs - utilisés quand Chromium ne donne pas de nom
// lisible (fréquent sous Windows avec le renderer ANGLE).
const VENDOR_NAMES: Record<number, string> = {
  0x10de: 'NVIDIA',
  0x1002: 'AMD',
  0x8086: 'Intel',
  0x106b: 'Apple',
}

/** Sous-ensemble de ce que renvoie app.getGPUInfo('complete') qui nous intéresse. */
interface GpuInfo {
  auxAttributes?: { glRenderer?: string }
  gpuDevice?:     Array<{ active?: boolean; vendorId?: number; deviceId?: number }>
}

/** Nom lisible du GPU, ou null si Chromium n'expose rien d'exploitable. */
async function detectGpuName(): Promise<string | null> {
  try {
    // getGPUInfo peut ne jamais se résoudre sur certaines configs Linux sans
    // accélération - on ne bloque pas le démarrage pour ça.
    const info = await Promise.race([
      app.getGPUInfo('complete') as Promise<GpuInfo>,
      new Promise<null>(resolve => setTimeout(() => resolve(null), 4000)),
    ])
    if (!info) return null

    const renderer = info.auxAttributes?.glRenderer
    if (renderer && renderer.trim()) return cleanRendererString(renderer)

    const devices = info.gpuDevice ?? []
    const device  = devices.find(d => d.active) ?? devices[0]
    if (!device?.vendorId) return null
    // Seul le fondeur est connu : on l'affiche tel quel. L'identifiant PCI de la
    // puce ne dit rien à un joueur, et le palier se décide sur le fondeur.
    return VENDOR_NAMES[device.vendorId] ?? null
  } catch {
    return null
  }
}

/**
 * Sous Windows, Chromium rend via ANGLE et renvoie des chaînes du type
 * « ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11) ».
 * C'est le cas de très loin le plus fréquent chez les joueurs : le deuxième
 * champ contient le vrai nom de la carte, suivi de détails Direct3D à jeter.
 */
function cleanRendererString(raw: string): string {
  const angle = raw.match(/^ANGLE \([^,]+, ([^,]+),/)
  if (angle) {
    return angle[1]
      .replace(/\s+Direct3D\d*.*$/i, '')
      .replace(/\s+vs_\d.*$/i, '')
      .trim()
  }
  // Ailleurs (OpenGL sous Linux/macOS) : « NVIDIA GeForce RTX 3060/PCIe/SSE2 »
  // ou « AMD Radeon Graphics (radeonsi) » - on retire le suffixe entre
  // parenthèses, qui décrit le pilote et pas la carte. La parenthèse doit être
  // précédée d'une espace, sinon « Intel(R) UHD Graphics 630 » serait réduit au
  // seul mot « Intel ».
  return raw.replace(/\s+\(.*$/, '').trim() || raw.trim()
}

function classifyGpu(name: string | null): { kind: HardwareInfo['gpuKind']; score: number } {
  if (!name) return { kind: 'unknown', score: 1 }
  const n = name.toLowerCase()

  // Intégrés : la mémoire vidéo est prise sur la RAM système, le budget de
  // rendu est faible quel que soit le reste de la machine.
  if (/uhd graphics|hd graphics|iris|vega \d| radeon graphics|integrated/.test(n)) {
    return { kind: 'integrated', score: 1 }
  }
  if (/apple m\d/.test(n))                              return { kind: 'dedicated', score: 3 }
  if (/rtx [2-9]\d{3}|gtx 16\d{2}/.test(n))             return { kind: 'dedicated', score: 3 }
  if (/rx [5-9]\d{3}|rx 7\d{2}0|radeon rx [5-9]/.test(n)) return { kind: 'dedicated', score: 3 }
  if (/arc a\d{3}/.test(n))                             return { kind: 'dedicated', score: 2 }
  if (/geforce|quadro|radeon|firepro/.test(n))          return { kind: 'dedicated', score: 2 }

  // Chromium n'a donné qu'un identifiant de fondeur (fréquent sous Linux, où
  // glRenderer n'est pas toujours exposé). Le fondeur suffit à ne pas sous-
  // estimer la machine : NVIDIA ne fabrique que du dédié côté PC, Intel est
  // presque toujours intégré, AMD peut être l'un ou l'autre (APU) - d'où un
  // score prudent plutôt que le maximum.
  if (/^nvidia/.test(n)) return { kind: 'dedicated',  score: 3 }
  if (/^amd/.test(n))    return { kind: 'dedicated',  score: 2 }
  if (/^intel/.test(n))  return { kind: 'integrated', score: 1 }

  return { kind: 'unknown', score: 1 }
}

function scoreRam(gb: number): number {
  if (gb < 8)  return 0
  if (gb < 12) return 1
  if (gb < 16) return 2
  return 3
}

function scoreCpu(cores: number): number {
  if (cores < 4) return 0
  if (cores < 6) return 1
  if (cores < 8) return 2
  return 3
}

export async function detectHardware(): Promise<HardwareInfo> {
  const list       = cpus()
  const cpuCores   = list.length || 1
  const cpuModel   = (list[0]?.model ?? 'Processeur inconnu').replace(/\s+/g, ' ').trim()
  const totalRamGB = Math.round(totalmem() / 1024 / 1024 / 1024)

  const gpuName = await detectGpuName()
  const gpu     = classifyGpu(gpuName)

  const score = scoreRam(totalRamGB) + scoreCpu(cpuCores) + gpu.score

  // Un GPU intégré plafonne au palier Moyen même avec un très bon CPU : c'est
  // lui qui limite le nombre d'images par seconde, pas le reste.
  let recommended: PerfLevel = score <= 3 ? 'low' : score <= 6 ? 'medium' : 'high'
  if (gpu.kind === 'integrated' && recommended === 'high') recommended = 'medium'
  // Sous 8 Go de RAM physique, aucun palier au-dessus de Faible ne tient.
  if (totalRamGB < 8) recommended = 'low'

  return { cpuCores, cpuModel, totalRamGB, gpuName, gpuKind: gpu.kind, score, recommended }
}
