import Store from 'electron-store'
import { safeStorage } from 'electron'
import { recommendedRam } from './perfProfiles'
import type { PerfLevel } from './perfProfiles'

export interface Account {
  username:        string
  uuid:            string
  token:           string
  tokenExpires:    number  // timestamp Unix en secondes
  isAdmin:         boolean
  // Indicatif UI (affichage du bouton DEV) - jamais une source d'autorité :
  // le téléchargement des fichiers dev revérifie ce même token côté serveur
  // (voir hasDevServerAccess() dans index.php), et le serveur Minecraft dev
  // est protégé séparément par whitelist.
  canAccessDevServer: boolean
}

export interface LaunchProfile {
  id:        string
  name:      string
  ram:       number
  resW:      number
  resH:      number
  javaPath:  string | null
  /** Palier de performance : pilote mods, arguments JVM et réglages graphiques. */
  perfLevel: PerfLevel
  /** true pour les trois paliers fournis avec le launcher - non supprimables, non modifiables. */
  builtin:   boolean
  /**
   * Sélection de mods optionnels propre au profil.
   * null = suit le palier (cas des profils intégrés et d'un profil perso non modifié).
   * Tableau = sélection figée par le joueur.
   */
  mods:      string[] | null
  /**
   * Réglages graphiques Minecraft modifiés à la main, par-dessus ceux du palier.
   * null ou {} = tout vient du palier. Seules les clés présentes sont surchargées,
   * ce qui laisse un profil suivre le palier sur le reste.
   */
  gameOptions: Record<string, string> | null
}

export const BUILTIN_PROFILE_IDS = ['perf-low', 'perf-medium', 'perf-high'] as const

/** Résolution de lancement associée à chaque palier - un rendu plus large coûte plus cher. */
const BUILTIN_RES: Record<PerfLevel, { w: number; h: number }> = {
  low:    { w: 854,  h: 480  },
  medium: { w: 1280, h: 720  },
  high:   { w: 1920, h: 1080 },
}

const BUILTIN_NAMES: Record<PerfLevel, string> = {
  low:    'Faible',
  medium: 'Moyen',
  high:   'Élevé',
}

/** Profil intégré d'un palier, dimensionné pour la RAM physique de la machine. */
export function builtinProfile(level: PerfLevel, totalRamGB: number): LaunchProfile {
  const res = BUILTIN_RES[level]
  return {
    id:        `perf-${level}`,
    name:      BUILTIN_NAMES[level],
    ram:       recommendedRam(level, totalRamGB),
    resW:      res.w,
    resH:      res.h,
    javaPath:    null,
    perfLevel:   level,
    builtin:     true,
    mods:        null,
    gameOptions: null,
  }
}

interface Schema {
  ram:                    number
  resolutionWidth:        number
  resolutionHeight:       number
  javaPath:               string | null
  account:                Account | null        // legacy - conservé pour migration
  accounts:               Account[]
  activeAccountId:        string | null
  soundEnabled:           boolean
  /** Sélection de mods appliquée au jeu - dérivée du profil actif (voir applyActiveProfile). */
  enabledOptionalMods:    string[]
  lastSeenNewsCount:      number
  launchProfiles:         LaunchProfile[]
  activeProfileId:        string
  closeOnLaunch:          boolean
  /** Le joueur a validé (ou refusé) la proposition de palier au premier démarrage. */
  perfConfigured:         boolean
  /** Dernier catalogue de mods optionnels connu - permet d'appliquer un palier hors ligne. */
  knownOptionalMods:      string[]
}

export const store = new Store<Schema>({
  defaults: {
    ram:                    4,
    resolutionWidth:        854,
    resolutionHeight:       480,
    javaPath:               null,
    account:                null,
    accounts:               [],
    activeAccountId:        null,
    soundEnabled:           true,
    enabledOptionalMods:    [],
    lastSeenNewsCount:      0,
    launchProfiles:         [],   // rempli par migrateProfiles() au démarrage
    activeProfileId:        'perf-medium',
    closeOnLaunch:          false,
    perfConfigured:         false,
    knownOptionalMods:      [],
  }
})

// ─── Chiffrement au repos des tokens de compte ─────────────────────────────
//
// Utilise le coffre-fort natif de l'OS (Keychain macOS / DPAPI Windows /
// libsecret Linux) via safeStorage, PAS une clé embarquée dans l'app comme le
// ferait l'option `encryptionKey` d'electron-store. Le secret de chiffrement
// est donc lié à la session du système, pas au binaire du launcher : copier ou
// exfiltrer le fichier de config ne suffit pas à récupérer le token en clair
// sur une autre machine.
//
// Dégradation gracieuse : si l'OS n'expose aucun coffre-fort disponible (ex.
// certaines installations Linux sans keyring), le token est stocké tel quel
// plutôt que de bloquer la connexion - identique au comportement historique
// dans ce cas précis uniquement.

function encryptToken(token: string): string {
  if (!safeStorage.isEncryptionAvailable()) return token
  return safeStorage.encryptString(token).toString('base64')
}

function decryptToken(token: string): string {
  if (!safeStorage.isEncryptionAvailable()) return token
  try {
    return safeStorage.decryptString(Buffer.from(token, 'base64'))
  } catch {
    // Valeur historique non chiffrée (avant ce correctif), ou coffre-fort
    // d'une autre machine/OS - retournée telle quelle plutôt que de faire
    // planter la lecture du compte.
    return token
  }
}

function encryptAccount(a: Account): Account {
  return { ...a, token: encryptToken(a.token) }
}

function decryptAccount(a: Account): Account {
  return { ...a, token: decryptToken(a.token) }
}

/** Liste des comptes, tokens déchiffrés - à utiliser à la place de store.get('accounts'). */
export function getStoredAccounts(): Account[] {
  return ((store.get('accounts') as Account[]) ?? []).map(decryptAccount)
}

/** Persiste la liste des comptes, tokens chiffrés - à utiliser à la place de store.set('accounts', ...). */
export function setStoredAccounts(accounts: Account[]): void {
  store.set('accounts', accounts.map(encryptAccount))
}

/** Compte legacy (compat), token déchiffré - à utiliser à la place de store.get('account'). */
export function getStoredAccount(): Account | null {
  const a = store.get('account') as Account | null
  return a ? decryptAccount(a) : null
}

/** Persiste le compte legacy, token chiffré - à utiliser à la place de store.set('account', ...). */
export function setStoredAccount(account: Account | null): void {
  store.set('account', account ? encryptAccount(account) : null)
}

// ─── Profils de lancement ──────────────────────────────────────────────────
//
// Depuis la v1.5.0 un profil porte aussi un palier de performance. Trois
// profils intégrés (Faible / Moyen / Élevé) sont toujours présents ; le joueur
// peut en créer autant qu'il veut par-dessus.

/** Valeurs par défaut historiques du profil « default » (avant les paliers). */
function isUntouchedLegacyDefault(p: LaunchProfile): boolean {
  return p.id === 'default'
    && p.ram  === 4
    && p.resW === 854
    && p.resH === 480
    && !p.javaPath
}

/**
 * Garantit la présence des trois profils intégrés et complète les profils
 * enregistrés avant l'arrivée des paliers.
 *
 * Rien n'est perdu à la mise à jour : un profil existant garde sa RAM, sa
 * résolution et son Java, reçoit le palier Moyen (comportement le plus proche
 * de l'ancien launcher, qui activait tous les mods optionnels) et fige la
 * sélection de mods actuelle du joueur pour qu'elle ne bouge pas.
 *
 * @param totalRamGB RAM physique, pour dimensionner les profils intégrés.
 */
export function migrateProfiles(totalRamGB: number): void {
  const stored  = (store.get('launchProfiles') as LaunchProfile[]) ?? []
  const current = (store.get('enabledOptionalMods') as string[]) ?? []

  // Le profil « default » d'origine, jamais retouché, n'apporte rien face aux
  // profils intégrés - sauf s'il porte une sélection de mods, qui est alors la
  // seule trace de ce que le joueur avait choisi.
  const dropDefault = (p: LaunchProfile) => isUntouchedLegacyDefault(p) && current.length === 0

  const customs = stored
    .filter(p => !dropDefault(p))
    .filter(p => !(BUILTIN_PROFILE_IDS as readonly string[]).includes(p.id))
    .map<LaunchProfile>(p => ({
      ...p,
      name:      p.id === 'default' && p.name === 'Défaut' ? 'Ma configuration' : p.name,
      perfLevel: p.perfLevel ?? 'medium',
      builtin:   false,
      // undefined = profil d'avant les paliers → on fige sa sélection actuelle.
      // null explicite = profil qui suit volontairement son palier.
      mods:        p.mods === undefined ? current : p.mods,
      gameOptions: p.gameOptions ?? null,
    }))

  const builtins = (['low', 'medium', 'high'] as PerfLevel[]).map(level => {
    const existing = stored.find(p => p.id === `perf-${level}`)
    // Un profil intégré déjà présent est conservé tel quel : le joueur a pu en
    // ajuster la RAM ou la résolution depuis l'interface.
    return existing
      ? { ...existing, builtin: true, perfLevel: level, mods: null, gameOptions: null }
      : builtinProfile(level, totalRamGB)
  })

  const profiles = [...builtins, ...customs]
  store.set('launchProfiles', profiles)

  const activeId = store.get('activeProfileId') as string
  if (!profiles.some(p => p.id === activeId)) {
    // Le profil actif a disparu (ou c'était le « default » retiré ci-dessus) :
    // un joueur qui arrivait d'une version sans paliers avec une sélection de
    // mods garde cette sélection, les autres partent du palier Moyen.
    const fallback = customs.find(p => p.id === 'default') ?? null
    store.set('activeProfileId', fallback ? fallback.id : 'perf-medium')
  }
}

/** Profil de lancement actif. Ne renvoie jamais null : replie sur Moyen. */
export function getActiveProfile(): LaunchProfile {
  const profiles = (store.get('launchProfiles') as LaunchProfile[]) ?? []
  const activeId = store.get('activeProfileId') as string
  return profiles.find(p => p.id === activeId)
    ?? profiles.find(p => p.id === 'perf-medium')
    ?? builtinProfile('medium', 8)
}
