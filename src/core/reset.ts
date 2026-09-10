import * as fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import * as path from 'node:path'
import { type Result, ok, err } from './result.js'
import { safeResolve } from './paths.js'
import { createState, writeState } from './state.js'
import { readImportedParcours } from './progression.js'

/**
 * Les deux seules formes de réinitialisation, et ce qu'elles touchent :
 *
 * - `restartParcours` : réécrit `.learn/state.json` sur la première étape. Les tests
 *   restent, le parcours reste ;
 * - `removeParcours` : vide `.learn/` — progression, tests, config, cache — **sauf les
 *   fichiers de parcours générés** (`.learn/parcours/*.json`).
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

/**
 * Vide `.learn/` **en gardant les parcours générés** (D38), et retourne ce qui a été gardé.
 *
 * Un parcours est le produit d'un aller-retour avec un agent, facturé à l'utilisateur : le
 * supprimer avec la progression fait payer deux fois la même chose, et c'est irréversible.
 * Tout le reste — état, tests, config, cache — se réécrit à l'import, donc part.
 *
 * Sans aucun JSON à garder, `.learn/` disparaît en entier : on ne laisse pas un dossier
 * vide derrière au nom d'un fichier qui n'existe pas.
 */
export async function removeParcours(workspaceRoot: string): Promise<Result<readonly string[]>> {
  const learnDir = safeResolve(workspaceRoot, '.learn')
  const parcoursDir = safeResolve(workspaceRoot, '.learn/parcours')
  if (!learnDir.ok) return err(learnDir.error)
  if (!parcoursDir.ok) return err(parcoursDir.error)

  let entries: Dirent[]
  try {
    entries = await fs.readdir(parcoursDir.value, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return err(
        `La lecture de .learn/parcours/ a échoué : ${error instanceof Error ? error.message : String(error)}`
      )
    }
    entries = []
  }
  const kept = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()

  try {
    if (kept.length === 0) {
      await fs.rm(learnDir.value, { recursive: true, force: true })
      return ok([])
    }
    // Les noms viennent de `readdir`, jamais du parcours : rien à revalider ici, et tout
    // reste sous `.learn/`.
    for (const entry of await fs.readdir(learnDir.value)) {
      if (entry === 'parcours') continue
      await fs.rm(path.join(learnDir.value, entry), { recursive: true, force: true })
    }
    for (const entry of entries) {
      if (kept.includes(entry.name)) continue
      await fs.rm(path.join(parcoursDir.value, entry.name), { recursive: true, force: true })
    }
  } catch (error) {
    return err(
      `Le nettoyage de .learn/ a échoué : ${error instanceof Error ? error.message : String(error)}`
    )
  }
  return ok(kept.map((name) => `.learn/parcours/${name}`))
}
