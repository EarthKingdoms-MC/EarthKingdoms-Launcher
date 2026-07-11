import fs from 'fs'
import path from 'path'
import * as nbt from 'prismarine-nbt'
import type { NBT } from 'prismarine-nbt'

// Serveur de test — même hôte que la prod, port dédié (voir server.properties
// du serveur dev : server-port=39000). Le trafic passe par TCPShield/Cloudflare
// comme la prod, donc on utilise le même domaine public.
export const DEV_SERVER_NAME    = 'EarthKingdoms DEV'
export const DEV_SERVER_ADDRESS = 'mc.earthkingdoms-mc.fr:39000'

// La liste `servers` d'un NBT servers.dat contient directement les objets
// {name, ip} (pas de wrapper {type:'compound', value:...} par entrée) - les
// typings de prismarine-nbt sont imprécis sur ce point, d'où le `any` local.
type ServerEntry = { name: { type: 'string'; value: string }; ip: { type: 'string'; value: string } }

/**
 * Ajoute l'entrée du serveur dev à servers.dat si elle n'y est pas déjà -
 * ne touche jamais au fichier si l'entrée existe déjà (préserve l'ordre et
 * les autres serveurs que le joueur aurait ajoutés lui-même). Best-effort :
 * une erreur ici ne doit jamais bloquer le lancement du jeu.
 */
export function ensureDevServerEntry(instanceDir: string): void {
  try {
    fs.mkdirSync(instanceDir, { recursive: true })
    const filePath = path.join(instanceDir, 'servers.dat')

    let root: NBT | null = null
    if (fs.existsSync(filePath)) {
      try {
        root = nbt.parseUncompressed(fs.readFileSync(filePath), 'big')
      } catch {
        root = null // fichier corrompu/illisible → on repart d'une liste neuve
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const compoundValue: Record<string, any> = root?.value ?? {}
    const existingEntries: ServerEntry[] = compoundValue.servers?.value?.value ?? []

    const alreadyPresent = existingEntries.some(entry => entry.ip?.value === DEV_SERVER_ADDRESS)
    if (alreadyPresent) return

    const newEntry: ServerEntry = {
      name: { type: 'string', value: DEV_SERVER_NAME },
      ip:   { type: 'string', value: DEV_SERVER_ADDRESS },
    }

    const updated = {
      name: '',
      type: 'compound',
      value: {
        ...compoundValue,
        servers: {
          type: 'list',
          value: { type: 'compound', value: [...existingEntries, newEntry] },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any as NBT

    fs.writeFileSync(filePath, nbt.writeUncompressed(updated, 'big'))
  } catch {
    // Non bloquant — le joueur pourra toujours ajouter le serveur manuellement.
  }
}
