import * as fs from 'node:fs/promises'
import { type Result, ok, err } from './result.js'
import { safeResolve } from './paths.js'
import { createState, writeState } from './state.js'
import { readImportedParcours } from './progression.js'

/**
 * Les deux seules formes de réinitialisation, et ce qu'elles touchent :
 *
 * - `restartParcours` : réécrit `.learn/state.json` sur la première étape. Les tests
 *   restent, le parcours reste ;
 * - `removeParcours` : supprime `.learn/` en entier.
 *
 * Ni l'une ni l'autre ne touche une seule ligne écrite par l'utilisateur. C'est la peur
 * qu'on a en cliquant, et c'est aussi la garantie que le code doit tenir : tout ce qui est
 * supprimé ici est sous `.learn/`, jamais ailleurs.
 */

export async function restartParcours(workspaceRoot: string): Promise<Result<string>> {
  const stateFile = safeResolve(workspaceRoot, '.learn/state.json')
  if (!stateFile.ok) return err(stateFile.error)

  const parcours = await readImportedParcours(workspaceRoot)
  if (!parcours.ok) return parcours

  const first = parcours.value.steps[0]
  if (first === undefined) return err("Le parcours ne contient aucune étape.")

  await writeState(stateFile.value, createState(parcours.value.slug, first.id))
  return ok(first.id)
}

export async function removeParcours(workspaceRoot: string): Promise<Result<void>> {
  const learnDir = safeResolve(workspaceRoot, '.learn')
  if (!learnDir.ok) return err(learnDir.error)

  try {
    await fs.rm(learnDir.value, { recursive: true, force: true })
  } catch (error) {
    return err(
      `La suppression de .learn/ a échoué : ${error instanceof Error ? error.message : String(error)}`
    )
  }
  return ok(undefined)
}
