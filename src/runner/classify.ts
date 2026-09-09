import * as path from 'node:path'
import type { Step } from '../core/parcours.js'
import type { Assertion, RawResult, TestFile } from './parse.js'

/** Voir le tableau des trois états rouges dans docs/UX.md. */
export type State = 'pass' | 'missing-file' | 'parse-error' | 'assertion-failed'

export interface Classification {
  readonly state: State
  /**
   * Détail à afficher. Absent quand il n'y a rien à dire (`pass`, et `missing-file` qui
   * est l'état normal de début d'étape). Présent sur toute erreur, y compris celles qui
   * ne sont pas de notre fait : un module introuvable qui ne correspond à aucun fichier
   * attendu remonte ici plutôt que d'être avalé en `missing-file`.
   */
  readonly message?: string
  /** Assertions en échec de cette étape, pour l'affichage attendu / reçu. */
  readonly failures: readonly Assertion[]
}

const CANNOT_FIND_MODULE = /Cannot find module ['"]([^'"]+)['"]/

export function classify(raw: RawResult, step: Step): Classification {
  const assertions = raw.files.flatMap((file) => file.assertions).filter((a) => belongsTo(a, step))

  const failures = assertions.filter((a) => a.status === 'failed')
  if (failures.length > 0) {
    return { state: 'assertion-failed', message: failures[0]?.failureMessages[0], failures }
  }
  if (assertions.some((a) => a.status === 'passed')) {
    return { state: 'pass', failures: [] }
  }

  // Aucun test de l'étape n'a tourné : c'est une erreur de collecte, reste à savoir
  // laquelle. Les compteurs ne les distinguent pas, seul le message le fait.
  const file = raw.files.find((f) => isStepFile(f, step))
  if (file === undefined) {
    return { state: 'parse-error', message: `aucun résultat pour ${step.tests.file}`, failures: [] }
  }

  const missing = CANNOT_FIND_MODULE.exec(file.message)?.[1]
  if (missing !== undefined) {
    return expects(step, missing)
      ? { state: 'missing-file', failures: [] }
      : { state: 'parse-error', message: file.message, failures: [] }
  }

  return {
    state: 'parse-error',
    message: file.message === '' ? `aucun test exécuté pour ${step.tests.file}` : file.message,
    failures: [],
  }
}

/**
 * `step 1.1` ne doit pas attraper `step 1.10` : le nom de l'étape doit être suivi d'une
 * frontière, pas d'un caractère qui prolongerait l'identifiant.
 */
function belongsTo(assertion: Assertion, step: Step): boolean {
  const prefix = new RegExp(`^step ${escapeRegex(step.id)}(?![\\w.-])`)
  return prefix.test(assertion.fullName.trim())
}

function isStepFile(file: TestFile, step: Step): boolean {
  return file.name.replace(/\\/g, '/').endsWith(step.tests.file)
}

/**
 * Le spécificateur est relatif au fichier de test. On le ramène à un chemin relatif au
 * projet pour le comparer à `expected.files`, sans jamais toucher au disque.
 */
function expects(step: Step, specifier: string): boolean {
  const dir = path.posix.dirname(step.tests.file)
  const target = path.posix.normalize(path.posix.join(dir, specifier))
  return step.expected.files.some((file) => path.posix.normalize(file) === target)
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
