import { app } from 'electron'
import { join } from 'path'
import { existsSync, renameSync } from 'fs'

// Emplacement du jeu, sur le modèle de .minecraft : %APPDATA%\.earthkingdoms
// (accessible directement par les joueurs, hors du dossier interne du launcher).
//
// Nom de l'instance : un nom par grande version du jeu (EarthKingdoms-beta, puis
// EarthKingdoms-v4, ...). Le mode dev partage la même instance : seul le modpack
// téléchargé et le serveur rejoint diffèrent.
export const INSTANCE_NAME = 'EarthKingdoms-beta'

/** Racine mc-java-core : contient instances/, versions/, libraries/, runtime/... */
export const gameRoot = (): string => join(app.getPath('appData'), '.earthkingdoms')

/** Dossier Minecraft (équivalent de .minecraft) de l'instance. */
export const instanceDir = (name: string = INSTANCE_NAME): string => join(gameRoot(), 'instances', name)

/**
 * Migration unique depuis l'ancien emplacement (<userData>/EarthKingdoms, instance
 * "EarthKingdoms"). Déplacement par simple renommage : instantané et sans copie.
 * Best-effort : si le renommage échoue (jeu encore ouvert, autre disque...), on repart
 * simplement d'une installation vierge, l'ancien dossier n'est jamais supprimé.
 */
export function migrateLegacyGameRoot(): void {
  const legacyRoot = join(app.getPath('userData'), 'EarthKingdoms')
  const newRoot    = gameRoot()

  if (existsSync(legacyRoot) && !existsSync(newRoot)) {
    try { renameSync(legacyRoot, newRoot) } catch { /* installation vierge */ }
  }

  const legacyInstance = join(newRoot, 'instances', 'EarthKingdoms')
  if (existsSync(legacyInstance) && !existsSync(instanceDir())) {
    try { renameSync(legacyInstance, instanceDir()) } catch { /* installation vierge */ }
  }
}
