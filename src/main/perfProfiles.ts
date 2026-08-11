import fs   from 'fs'
import path from 'path'

// ─────────────────────────────────────────────────────────────────────────────
// Paliers de performance
//
// Un palier pilote trois choses à la fois :
//   1. quels mods optionnels sont activés  (voir MOD_TIERS / modsForLevel)
//   2. la RAM allouée et les arguments JVM (voir recommendedRam / gcArgs)
//   3. les réglages graphiques de Minecraft (voir MC_OPTIONS / applyGameOptions)
//
// Les paliers sont cumulatifs : Moyen contient tout Faible, Élevé contient tout
// Moyen. Un joueur ne perd donc jamais un mod en montant de palier.
// ─────────────────────────────────────────────────────────────────────────────

export type PerfLevel = 'low' | 'medium' | 'high'

export const PERF_LEVELS: PerfLevel[] = ['low', 'medium', 'high']

export const LEVEL_LABELS: Record<PerfLevel, string> = {
  low:    'Faible',
  medium: 'Moyen',
  high:   'Élevé',
}

export const LEVEL_DESCS: Record<PerfLevel, string> = {
  low:    'Mods obligatoires + optimisation uniquement. Priorité aux FPS sur les machines modestes.',
  medium: 'Ajoute le confort de jeu (JEI, Jade, zoom, animations). Le bon compromis pour la plupart des PC.',
  high:   'Tout est activé, shaders et carte inclus. Réglages graphiques poussés.',
}

export function isPerfLevel(v: unknown): v is PerfLevel {
  return v === 'low' || v === 'medium' || v === 'high'
}

/** Rang numérique du palier - sert à tester l'inclusion cumulative. */
function rank(level: PerfLevel): number {
  return level === 'low' ? 0 : level === 'medium' ? 1 : 2
}

// ─── Classement des mods optionnels ──────────────────────────────────────────
//
// Table locale volontairement (décision : pas de manifest côté serveur pour
// l'instant). La clé est le début du nom de fichier, insensible à la casse :
// « embeddium » matche « embeddium-0.3.31+mc1.20.1.jar » mais pas un
// hypothétique « embeddiumplus-… » (le caractère suivant doit être un
// séparateur, voir modTier).
//
// Un mod absent de cette table est classé 'medium' : il apparaîtra dès le
// palier Moyen. C'est le défaut prudent - un nouveau mod poussé côté serveur
// n'est jamais imposé aux petites configs, et n'est jamais perdu non plus.

const MOD_TIERS: Record<string, PerfLevel> = {
  // ── Faible : gain de performance net, aucun ajout de contenu ──
  'embeddium':                  'low',  // moteur de rendu (portage Sodium)
  'rubidium-extra':             'low',  // options de rendu supplémentaires (dépend d'embeddium)
  'ferritecore':                'low',  // réduit l'empreinte mémoire
  'modernfix':                  'low',  // démarrage + mémoire
  'immediatelyfast':            'low',  // batching du rendu immédiat
  'fastsuite':                  'low',  // cache des recettes
  'ksyxis':                     'low',  // supprime le pré-chargement des chunks au join
  'gpumemleakfix':              'low',  // corrige une fuite mémoire GPU
  'fastpaintings':              'low',  // rendu des tableaux
  'fastquit':                   'low',  // fermeture du monde en arrière-plan

  // ── Moyen : confort de jeu, coût négligeable ──
  'jei':                        'medium',  // liste des recettes
  'jade':                       'medium',  // infos bloc/entité visé
  'mousetweaks':                'medium',  // manipulation d'inventaire
  'okzoomer':                   'medium',  // zoom clavier
  'notenoughanimations':        'medium',  // animations de joueur

  // ── Élevé : agréable mais réellement coûteux ──
  'oculus':                     'high',  // chargeur de shaders
  'journeymap':                 'high',  // minimap + cartographie (rendu continu)
  'sound-physics-remastered':   'high',  // réverbération calculée en temps réel
}

const UNKNOWN_MOD_TIER: PerfLevel = 'medium'

/** Nom de fichier nu, en minuscules, sans extension. */
function modKey(modPath: string): string {
  const file = modPath.split('/').pop() ?? modPath
  return file.replace(/\.(jar|zip)$/i, '').toLowerCase()
}

/**
 * Palier auquel un mod optionnel appartient.
 * Les mods admin ne sont jamais gérés par les paliers (voir modsForLevel).
 */
export function modTier(modPath: string): PerfLevel {
  const key = modKey(modPath)
  for (const [prefix, tier] of Object.entries(MOD_TIERS)) {
    if (!key.startsWith(prefix)) continue
    // Le caractère suivant doit être un séparateur pour éviter qu'un préfixe
    // court (« jei ») ne capture un mod sans rapport (« jeiintegration »).
    const next = key.charAt(prefix.length)
    if (next === '' || !/[a-z0-9]/.test(next)) return tier
  }
  return UNKNOWN_MOD_TIER
}

/**
 * Sélection de mods optionnels correspondant à un palier.
 *
 * @param allPaths       catalogue complet renvoyé par le serveur (modoptionnel/… et modadmin/…)
 * @param level          palier visé
 * @param keepAdminPaths mods admin actuellement actifs - conservés tels quels,
 *                       le palier ne les touche pas (ce sont des outils de
 *                       modération, pas un réglage de performance).
 */
export function modsForLevel(
  allPaths: string[],
  level: PerfLevel,
  keepAdminPaths: string[] = []
): string[] {
  const optional = allPaths
    .filter(p => p.startsWith('modoptionnel/'))
    .filter(p => rank(modTier(p)) <= rank(level))

  const admin = allPaths
    .filter(p => p.startsWith('modadmin/') && keepAdminPaths.includes(p))

  return [...optional, ...admin]
}

// ─── RAM et arguments JVM ────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/**
 * RAM conseillée pour un palier, bornée par la RAM physique de la machine.
 * On laisse toujours de la marge au système : Minecraft n'est jamais le seul
 * processus qui tourne.
 */
export function recommendedRam(level: PerfLevel, totalRamGB: number): number {
  const total = totalRamGB > 0 ? totalRamGB : 8

  const byLevel =
    level === 'low'    ? clamp(total - 3, 2, 4)  :
    level === 'medium' ? clamp(Math.floor(total / 2), 4, 6)
                       : clamp(Math.floor(total / 2), 6, 12)

  // Plafond absolu : le système d'exploitation garde 2 Go quoi qu'il arrive.
  // Sans ce garde-fou, choisir Élevé sur une machine de 4 Go demanderait un tas
  // plus gros que la RAM physique et la JVM refuserait de démarrer.
  return Math.min(byLevel, Math.max(2, total - 2))
}

/**
 * Arguments de GC. Base = flags d'Aikar, qui ont deux jeux de valeurs selon
 * que le tas dépasse 12 Go ou non - c'est la seule distinction documentée
 * côté JVM, on ne cherche pas à inventer au-delà.
 *
 * Deux écarts délibérés selon le palier :
 *  - AlwaysPreTouch réserve physiquement tout le tas au démarrage : gain de
 *    régularité sur une machine confortable, mais catastrophique sur une
 *    machine juste en RAM → retiré au palier Faible.
 *  - UseStringDeduplication rend de la mémoire au prix d'un peu de CPU pendant
 *    les GC : intéressant seulement quand la RAM est la ressource rare.
 */
export function gcArgs(level: PerfLevel, maxRamMB: number): string[] {
  const largeHeap = maxRamMB >= 12 * 1024

  const args = [
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200',
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC',
    '-XX:G1HeapWastePercent=5',
    '-XX:G1MixedGCCountTarget=4',
    '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:G1RSetUpdatingPauseTimePercent=5',
    '-XX:SurvivorRatio=32',
    '-XX:+PerfDisableSharedMem',
    '-XX:MaxTenuringThreshold=1',
  ]

  if (largeHeap) {
    args.push(
      '-XX:G1NewSizePercent=40',
      '-XX:G1MaxNewSizePercent=50',
      '-XX:G1HeapRegionSize=16M',
      '-XX:G1ReservePercent=15',
      '-XX:InitiatingHeapOccupancyPercent=20',
    )
  } else {
    args.push(
      '-XX:G1NewSizePercent=30',
      '-XX:G1MaxNewSizePercent=40',
      '-XX:G1HeapRegionSize=8M',
      '-XX:G1ReservePercent=20',
      '-XX:InitiatingHeapOccupancyPercent=15',
    )
  }

  if (level === 'low') args.push('-XX:+UseStringDeduplication')
  else                 args.push('-XX:+AlwaysPreTouch')

  return args
}

// ─── Réglages graphiques Minecraft ───────────────────────────────────────────
//
// Uniquement des clés liées à la performance. Tout le reste du options.txt
// (raccourcis clavier, volumes, FOV, luminosité…) appartient au joueur et
// n'est jamais réécrit - voir applyGameOptions.
//
// graphicsMode reste à 1 (Fancy) au palier Élevé : le mode 2 (Fabulous) est
// incompatible avec le chargeur de shaders Oculus, justement activé à ce
// palier. Les vrais leviers ici sont la distance d'affichage et les mipmaps.

const MC_OPTIONS: Record<PerfLevel, Record<string, string>> = {
  low: {
    renderDistance:         '6',
    simulationDistance:     '5',
    graphicsMode:           '0',
    particles:              '2',
    ao:                     'false',
    entityShadows:          'false',
    entityDistanceScaling:  '0.5',
    mipmapLevels:           '0',
    biomeBlendRadius:       '0',
    maxFps:                 '60',
    enableVsync:            'false',
    renderClouds:           '"false"',
    prioritizeChunkUpdates: '0',
  },
  medium: {
    renderDistance:         '10',
    simulationDistance:     '8',
    graphicsMode:           '1',
    particles:              '1',
    ao:                     'true',
    entityShadows:          'true',
    entityDistanceScaling:  '0.75',
    mipmapLevels:           '2',
    biomeBlendRadius:       '2',
    maxFps:                 '120',
    enableVsync:            'false',
    renderClouds:           '"fast"',
    prioritizeChunkUpdates: '0',
  },
  high: {
    renderDistance:         '16',
    simulationDistance:     '12',
    graphicsMode:           '1',
    particles:              '0',
    ao:                     'true',
    entityShadows:          'true',
    entityDistanceScaling:  '1.0',
    mipmapLevels:           '4',
    biomeBlendRadius:       '5',
    maxFps:                 '260',
    enableVsync:            'false',
    renderClouds:           '"true"',
    prioritizeChunkUpdates: '0',
  },
}

/**
 * Clés que le joueur peut régler à la main depuis l'interface. Les autres clés
 * de MC_OPTIONS restent pilotées par le palier : ce sont des détails que
 * personne ne va chercher, et les exposer noierait les réglages qui comptent.
 */
export const EDITABLE_GAME_KEYS = [
  'renderDistance',
  'simulationDistance',
  'graphicsMode',
  'particles',
  'renderClouds',
  'entityShadows',
  'entityDistanceScaling',
  'mipmapLevels',
  'maxFps',
  'enableVsync',
] as const

/**
 * Réglages effectifs : valeurs du palier, écrasées par les réglages que le
 * joueur a modifiés lui-même sur son profil. Un override sur une clé inconnue
 * est ignoré plutôt que propagé jusque dans le options.txt du jeu.
 */
export function gameOptionsFor(
  level: PerfLevel,
  overrides?: Record<string, string> | null
): Record<string, string> {
  const base = { ...MC_OPTIONS[level] }
  if (!overrides) return base
  for (const [key, value] of Object.entries(overrides)) {
    if (key in base) base[key] = value
  }
  return base
}

/**
 * Écrit les clés de performance du palier dans le options.txt d'une instance.
 *
 * Ne réécrit QUE les clés listées dans MC_OPTIONS : chaque autre ligne du
 * fichier est recopiée à l'identique, y compris les raccourcis clavier et les
 * volumes. Si le fichier n'existe pas encore (première installation), il est
 * créé avec les seules clés de performance - Minecraft complétera le reste
 * avec ses valeurs par défaut au premier démarrage.
 *
 * @returns true si le fichier a été écrit.
 */
export function applyGameOptions(
  instanceDir: string,
  level: PerfLevel,
  overrides?: Record<string, string> | null
): boolean {
  const target  = path.join(instanceDir, 'options.txt')
  const desired = gameOptionsFor(level, overrides)

  let lines: string[] = []
  try {
    if (fs.existsSync(target)) {
      lines = fs.readFileSync(target, 'utf8').split('\n').map(l => l.replace(/\r$/, ''))
    }
  } catch {
    return false
  }

  const seen = new Set<string>()
  const patched = lines.map(line => {
    const sep = line.indexOf(':')
    if (sep <= 0) return line
    const key = line.slice(0, sep)
    if (!(key in desired)) return line
    seen.add(key)
    return `${key}:${desired[key]}`
  })

  for (const [key, value] of Object.entries(desired)) {
    if (!seen.has(key)) patched.push(`${key}:${value}`)
  }

  // Évite une ligne vide finale en double sur un fichier déjà terminé par \n
  while (patched.length > 1 && patched[patched.length - 1] === '') patched.pop()

  try {
    fs.mkdirSync(instanceDir, { recursive: true })
    fs.writeFileSync(target, patched.join('\n') + '\n', 'utf8')
    return true
  } catch {
    return false
  }
}

/** true si l'instance n'a pas encore de options.txt (première installation). */
export function needsInitialGameOptions(instanceDir: string): boolean {
  try {
    return !fs.existsSync(path.join(instanceDir, 'options.txt'))
  } catch {
    return false
  }
}
