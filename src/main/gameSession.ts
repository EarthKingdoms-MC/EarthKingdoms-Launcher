/**
 * Registre de la session de jeu en cours côté launcher.
 *
 * Une seule instance de Minecraft à la fois (un seul dossier d'instance). Ce
 * module ne connaît ni l'authentification ni Electron : c'est précisément ce qui
 * garantit qu'une déconnexion, un renouvellement de token ou un changement de
 * compte ne peut pas arrêter ni invalider un jeu déjà lancé.
 *
 * Le jeu est lancé avec `detached: true` (voir launcherCore.ts) : son processus
 * survit à la fermeture du launcher. Le launcher ne le tue jamais de lui-même.
 */

export interface RunningLaunch {
  kill?(): void
}

/** Identité du compte au nom duquel la session a été démarrée (jamais de token). */
export interface SessionOwner {
  uuid:     string
  username: string
}

export function createGameSession() {
  let launch:  RunningLaunch | null = null
  let owner:   SessionOwner  | null = null
  let pending = false

  return {
    /**
     * Réserve la session avant les appels réseau préalables au lancement
     * (autorisation, catalogue de mods). Évite deux lancements simultanés -
     * et donc deux demandes de jeton de lancement - sur un double clic.
     */
    acquire(who: SessionOwner): boolean {
      if (pending || launch) return false
      pending = true
      owner   = who
      return true
    },

    /** Associe le processus effectivement démarré à la réservation. */
    attach(l: RunningLaunch): void {
      launch  = l
      pending = false
    },

    /** Libère la session (jeu fermé, échec de lancement ou abandon). */
    release(): void {
      launch  = null
      owner   = null
      pending = false
    },

    /** true dès la réservation, y compris pendant la phase réseau préalable. */
    isBusy(): boolean { return pending || launch !== null },

    /** true une fois le lancement démarré (téléchargements et jeu). */
    isRunning(): boolean { return launch !== null },

    /** Compte propriétaire de la session ; indépendant du compte actif du launcher. */
    getOwner(): SessionOwner | null { return owner },

    /** Demande explicite d'arrêt - jamais appelée par l'authentification. */
    stop(): void {
      try { launch?.kill?.() } finally { this.release() }
    },
  }
}

export type GameSession = ReturnType<typeof createGameSession>
