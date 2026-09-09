import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { ResolvedPath } from './paths.js'

/**
 * Écriture atomique : fichier temporaire dans le dossier de destination, puis `rename`.
 * Un import interrompu (process tué, disque plein) laisse au pire un `.tmp` orphelin,
 * jamais un fichier de test à moitié écrit que Vitest tenterait de collecter.
 *
 * Le paramètre est un `ResolvedPath` : impossible d'appeler cette fonction avec un chemin
 * qui n'est pas passé par `safeResolve`.
 */
export async function writeFileAtomic(target: ResolvedPath, content: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.tmp`
  try {
    await fs.writeFile(temp, content, 'utf8')
    await fs.rename(temp, target)
  } catch (error) {
    await fs.rm(temp, { force: true })
    throw error
  }
}
