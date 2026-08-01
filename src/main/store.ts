import Store from 'electron-store'
import { safeStorage } from 'electron'

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
  id:       string
  name:     string
  ram:      number
  resW:     number
  resH:     number
  javaPath: string | null
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
  enabledOptionalMods:    string[]
  optionalModsConfigured: boolean
  lastSeenNewsCount:      number
  launchProfiles:         LaunchProfile[]
  activeProfileId:        string
  closeOnLaunch:          boolean
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
    optionalModsConfigured: false,
    lastSeenNewsCount:      0,
    launchProfiles:         [{ id: 'default', name: 'Défaut', ram: 4, resW: 854, resH: 480, javaPath: null }],
    activeProfileId:        'default',
    closeOnLaunch:          false,
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
