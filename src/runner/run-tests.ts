import type { Result } from '../core/result.js'
import type { ResolvedPath } from '../core/paths.js'
import type { Parcours } from '../core/parcours.js'
import type { RawResult } from './parse.js'
import { type PytestOptions, runPytest } from './pytest.js'
import { run } from './vitest.js'

/**
 * Le seul endroit qui choisit le runner d'après `runner.kind` (D14, D39). `stepIds` vide
 * veut dire « toutes les étapes », pour les deux runners.
 */
export function runTests(
  parcours: Parcours,
  root: ResolvedPath,
  stepIds: readonly string[],
  options: PytestOptions = {}
): Promise<Result<RawResult>> {
  if (parcours.runner.kind === 'pytest') {
    const steps = stepIds.length === 0 ? parcours.steps : parcours.steps.filter((s) => stepIds.includes(s.id))
    return runPytest(root, steps, options)
  }
  return run(root, stepIds, options)
}
