import * as path from 'node:path'
import type { Step } from '../core/parcours.js'
import type { Assertion, RawResult, TestFile } from './parse.js'

/**
 * Voir le tableau des trois états rouges dans docs/UX.md.
 *
 * D33 : `parse-error` s'appelait ainsi parce que la spécification d'origine supposait que
 * la collecte ne peut échouer que sur le code de l'étudiant. C'est faux : la config Vite,
 * un plugin ou le runner la cassent tout aussi bien. Le nom affirmait une cause qu'on ne
 * connaît pas — il est devenu `collect-error`, qui ne dit que ce qu'on sait : aucun test
 * de l'étape n'a été collecté.
 */
export type State = 'pass' | 'missing-file' | 'collect-error' | 'assertion-failed'

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
  /**
   * `missing-file` seulement : le spécificateur que le test n'a pas su résoudre, tel qu'il
   * est écrit dans l'import. Il reste **hors** de `message`, qui est ce qu'on montre à
   * l'étudiant — pour lui, une étape pas commencée n'a rien à dire (UX.md). L'import, lui,
   * en a besoin : après avoir écrit la solution, « introuvable » ne veut plus dire « pas
   * encore écrit » mais « ne se résout pas », et le nom de l'alias est alors le diagnostic.
   */
  readonly missing?: string
}

/**
 * Trois textes pour une seule et même cause : le fichier que l'étape demande d'écrire
 * n'existe pas encore. Vite et Vitest n'en produisent pas le même selon la version et le
 * chemin de résolution — vérifié sur de vraies sorties :
 *
 * - `Cannot find module '<spec>'` — Vitest, import relatif ;
 * - `Cannot find package '<spec>'` — un **alias** du projet pointe un fichier absent, la
 *   résolution retombe sur node qui prend le spécificateur pour un paquet ;
 * - `Failed to resolve import "<spec>" from "<fichier>"` — Vite 8, analyse d'import.
 *
 * N'en connaître qu'un fait passer les deux autres pour « rien ne s'est collecté », donc
 * pour un parcours invalide alors qu'il est parfaitement normal.
 */
const CANNOT_FIND_MODULE =
  /Cannot find (?:module|package) ['"]([^'"]+)['"]|Failed to resolve import ['"]([^'"]+)['"]/

/**
 * La même cause côté Python (D39), deux formulations vérifiées sur de vraies sorties de
 * pytest (`__fixtures__/pytest/`) :
 *
 * - `No module named '<module>'` — le fichier du module n'existe pas encore ;
 * - `cannot import name '<nom>' from '<module>'` — le fichier existe, mais pas encore ce que
 *   l'étape y ajoute. En Python, un `from panier import total` échoue **à la collecte** là où
 *   JavaScript donnerait un `total is not a function` à l'exécution : sans ça, chaque étape
 *   après la première commencerait par « le fichier n'est pas encore valide ».
 *
 * Un import circulaire dit « from partially initialized module » et ne correspond pas : il
 * reste une vraie erreur de collecte.
 */
const PYTHON_MISSING =
  /No module named ['"]([^'"]+)['"]|cannot import name ['"]([^'"]+)['"] from ['"]([^'"]+)['"]/

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
    // Pas la moindre entrée pour ce fichier : Vitest ne l'a même pas atteint. On ne sait
    // pas pourquoi, et le supposer mal formé serait une invention.
    return { state: 'collect-error', message: `aucun résultat pour ${step.tests.file}`, failures: [] }
  }

  const found = CANNOT_FIND_MODULE.exec(file.message)
  const missing = found?.[1] ?? found?.[2]
  if (missing !== undefined) {
    return expects(step, missing)
      ? { state: 'missing-file', failures: [], missing }
      : { state: 'collect-error', message: file.message, failures: [] }
  }

  const python = PYTHON_MISSING.exec(file.message)
  if (python !== null) {
    const module = python[1] ?? python[3] ?? ''
    const name = python[1] ?? `${module}.${python[2] ?? ''}`
    return expectsModule(step, module)
      ? { state: 'missing-file', failures: [], missing: name }
      : { state: 'collect-error', message: file.message, failures: [] }
  }

  return {
    state: 'collect-error',
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
 *
 * Un spécificateur **non relatif** est un alias du projet (`@lib/calc.js`) : on ne connaît
 * pas la table d'alias, donc on compare les noms de fichier. C'est lâche, mais le pire cas
 * est bénin — on affiche « étape pas commencée » au lieu d'une erreur — alors que ne pas
 * le faire refuse un parcours parfaitement valide qui importe par alias.
 */
function expects(step: Step, specifier: string): boolean {
  if (!specifier.startsWith('.')) {
    const base = path.posix.basename(specifier)
    return step.expected.files.some((file) => path.posix.basename(file) === base)
  }
  const dir = path.posix.dirname(step.tests.file)
  const target = path.posix.normalize(path.posix.join(dir, specifier))
  return step.expected.files.some((file) => path.posix.normalize(file) === target)
}

/**
 * Un module pointé (`app.panier`) contre les `expected.files` Python de l'étape
 * (`app/panier.py`, `app/panier/__init__.py`). Les segments du module doivent se suivre dans
 * ceux du fichier : ça accepte `src/app/panier.py` importé comme `app.panier`, et `app`
 * seul quand c'est le paquet entier qui manque. Même tolérance, et même pire cas bénin, que
 * pour les alias JavaScript ci-dessus.
 */
function expectsModule(step: Step, module: string): boolean {
  return step.expected.files.some((file) => {
    if (!file.endsWith('.py')) return false
    const dotted = path.posix.normalize(file).replace(/(\/__init__)?\.py$/, '').split('/').join('.')
    return `.${dotted}.`.includes(`.${module}.`)
  })
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
