import Store from 'electron-store'

export interface Account {
  username:     string
  uuid:         string
  token:        string
  tokenExpires: number  // timestamp Unix en secondes
  isAdmin:      boolean
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
  account:                Account | null
  enabledOptionalMods:    string[]
  optionalModsConfigured: boolean
  lastSeenNewsCount:      number
  launchProfiles:         LaunchProfile[]
  activeProfileId:        string
}

export const store = new Store<Schema>({
  defaults: {
    ram:                    4,
    resolutionWidth:        854,
    resolutionHeight:       480,
    javaPath:               null,
    account:                null,
    enabledOptionalMods:    [],
    optionalModsConfigured: false,
    lastSeenNewsCount:      0,
    launchProfiles:         [{ id: 'default', name: 'Défaut', ram: 4, resW: 854, resH: 480, javaPath: null }],
    activeProfileId:        'default',
  }
})
