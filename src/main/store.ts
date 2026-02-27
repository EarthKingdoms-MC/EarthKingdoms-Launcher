import Store from 'electron-store'

export interface Account {
  username:     string
  uuid:         string
  token:        string
  tokenExpires: number  // timestamp Unix en secondes
  isAdmin:      boolean
}

interface Schema {
  ram:                       number
  resolutionWidth:           number
  resolutionHeight:          number
  javaPath:                  string | null
  account:                   Account | null
  enabledOptionalMods:       string[]
  optionalModsConfigured:    boolean
}

export const store = new Store<Schema>({
  defaults: {
    ram:                       4,
    resolutionWidth:           854,
    resolutionHeight:          480,
    javaPath:                  null,
    account:                   null,
    enabledOptionalMods:       [],
    optionalModsConfigured:    false,
  }
})
