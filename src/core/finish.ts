import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { type Result, ok, err } from './result.js'
import { type ResolvedPath, safeResolve } from './paths.js'

/** Dossiers de tests conventionnels, dans l'ordre où on les propose. */
const CANDIDATES = ['tests', 'test', '__tests__', 'spec', 'src/__tests__', 'src/tests', 'src/test']

const SOURCE_DIR = '.learn/tests'

export interface Move {
  readonly from: ResolvedPath
  readonly to: ResolvedPath
  /** Chemins relatifs au projet, pour la liste affichée avant confirmation. */
  readonly label: string
}

/**
 * Le seul candidat qui existe déjà, s'il n'y en a qu'un. Zéro ou plusieurs : on ne devine
 * pas, l'appelant demande à l'utilisateur.
 */
export async function detectTestsDir(root: ResolvedPath): Promise<string | undefined> {
  const found: string[] = []
  for (const candidate of CANDIDATES) {
    const target = safeResolve(root, candidate)
    if (!target.ok) continue
    if (await isDirectory(target.value)) found.push(candidate)
  }
  return found.length === 1 ? found[0] : undefined
}

/**
 * Prépare le déplacement sans rien écrire. C'est la seule opération de l'extension qui
 * touche des fichiers hors `.learn/` (D17) : elle refuse d'écraser quoi que ce soit, et
 * la liste retournée est faite pour être montrée avant confirmation.
 */
export async function planTestsMove(
  root: ResolvedPath,
  targetDir: string
): Promise<Result<readonly Move[]>> {
  const target = safeResolve(root, targetDir, { allowRoot: true })
  if (!target.ok) return err(`Dossier de destination refusé : ${target.error}`)

  const source = safeResolve(root, SOURCE_DIR)
  if (!source.ok) return err(source.error)
  if (path.relative(source.value, target.value) === '') {
    return err(`Le dossier de destination est déjà ${SOURCE_DIR}.`)
  }

  let names: string[]
  try {
    names = (await fs.readdir(source.value)).sort()
  } catch {
    return err(`Le dossier ${SOURCE_DIR} est introuvable.`)
  }
  if (names.length === 0) return err(`Le dossier ${SOURCE_DIR} est vide, il n'y a rien à déplacer.`)

  const moves: Move[] = []
  const conflicts: string[] = []
  for (const name of names) {
    const from = safeResolve(root, `${SOURCE_DIR}/${name}`)
    const to = safeResolve(root, path.posix.join(targetDir, name), { allowRoot: true })
    if (!from.ok || !to.ok) return err(`Nom de fichier refusé : ${name}`)
    if (await exists(to.value)) {
      conflicts.push(path.relative(root, to.value))
      continue
    }
    moves.push({ from: from.value, to: to.value, label: path.relative(root, to.value) })
  }

  if (conflicts.length > 0) {
    return err(
      `Ces fichiers existent déjà et ne seront pas écrasés : ${conflicts.join(', ')}. Choisis un autre dossier ou renomme-les.`
    )
  }
  return ok(moves)
}

export async function applyTestsMove(moves: readonly Move[]): Promise<Result<readonly string[]>> {
  const done: string[] = []
  try {
    for (const move of moves) {
      await fs.mkdir(path.dirname(move.to), { recursive: true })
      // ponytail : `rename` échouerait entre deux volumes. Source et destination sont dans
      // le même workspace, passer par copie+suppression le jour où ce ne sera plus vrai.
      await fs.rename(move.from, move.to)
      done.push(move.label)
    }
  } catch (error) {
    return err(
      `Le déplacement s'est arrêté après ${done.length} fichier(s) : ${error instanceof Error ? error.message : String(error)}`
    )
  }
  return ok(done)
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory()
  } catch {
    return false
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target)
    return true
  } catch {
    return false
  }
}
