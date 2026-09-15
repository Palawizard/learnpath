import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import schema from '../../schema/parcours.schema.json'
import { type Result, ok, err } from './result.js'
import { safeResolve } from './paths.js'
import { validateCommand } from './validate-commands.js'

/** La commande de chaque runner est construite par l'extension (D14, D39). */
export type RunnerKind = 'vitest' | 'pytest'

export interface Runner {
  readonly kind: RunnerKind
  readonly cwd?: string
  /**
   * Environnement de test Vitest (D31). Absent = déduit : « node », sauf si `setup` installe
   * jsdom ou happy-dom. Un parcours qui teste un composant doit le déclarer. Refusé avec
   * pytest, où il ne veut rien dire.
   */
  readonly environment?: 'node' | 'jsdom' | 'happy-dom' | 'edge-runtime'
  readonly setup?: readonly string[]
}

export interface Contract {
  readonly files: Readonly<Record<string, string>>
  readonly notes?: string
}

export interface StepExpected {
  readonly files: readonly string[]
  readonly contract?: string
  readonly acceptance?: readonly string[]
}

export interface StepTests {
  readonly file: string
  readonly grep: string
  readonly content: string
}

export interface Step {
  readonly id: string
  readonly title: string
  readonly explanation: string
  readonly expected: StepExpected
  readonly tests: StepTests
  readonly hints?: readonly string[]
  readonly solution: Readonly<Record<string, string>>
}

export interface Parcours {
  readonly version: 1
  readonly slug: string
  readonly title: string
  readonly intro?: string
  readonly runner: Runner
  readonly contract?: Contract
  readonly steps: readonly Step[]
}

export interface ValidationError {
  /** Pointeur JSON dans le parcours, ex. `/steps/2/tests/grep`. Vide pour la racine. */
  readonly path: string
  /** Message en français, destiné à l'auteur du parcours. */
  readonly message: string
}

/** Dossier imposé pour les fichiers de test, voir SPEC-PARCOURS.md. */
const TESTS_DIR = '.learn/tests/'

/**
 * `loadParcours` valide la *forme* du parcours, pas son emplacement : on n'a pas encore
 * le dossier de l'utilisateur ici. Cette racine fictive suffit pour que `safeResolve`
 * fasse son travail lexical (absolu, `..`, antislash, sortie de racine).
 */
const VALIDATION_ROOT = '/learnpath'

const ajv = new Ajv2020({ allErrors: true, strict: false })
let compiled: ValidateFunction | undefined

function validator(): ValidateFunction {
  compiled ??= ajv.compile(schema)
  return compiled
}

export function loadParcours(raw: unknown): Result<Parcours, ValidationError[]> {
  const validate = validator()
  if (!validate(raw)) {
    const errors = (validate.errors ?? []).map((e) => translate(e, raw))
    return err(dedupe(errors))
  }

  const parcours = raw as Parcours
  const semantic = checkSemantics(parcours)
  return semantic.length > 0 ? err(semantic) : ok(parcours)
}

// --- Règles qu'un JSON Schema ne peut pas exprimer -------------------------------------

function checkSemantics(parcours: Parcours): ValidationError[] {
  const errors: ValidationError[] = []

  const kind = parcours.runner.kind
  parcours.runner.setup?.forEach((cmd, i) => {
    const r = validateCommand(cmd, kind)
    if (!r.ok) {
      errors.push({ path: `/runner/setup/${i}`, message: `Runner, setup[${i}] : ${r.error}` })
    }
  })
  if (kind === 'pytest' && parcours.runner.environment !== undefined) {
    errors.push({
      path: '/runner/environment',
      message: `Runner, champ environment : il ne s'applique qu'à Vitest (jsdom, happy-dom…), retire-le d'un parcours pytest`,
    })
  }
  // « . » désigne la racine du projet, seul cas où on accepte la racine elle-même.
  if (parcours.runner.cwd !== undefined) {
    const r = safeResolve(VALIDATION_ROOT, parcours.runner.cwd, { allowRoot: true })
    if (!r.ok) {
      errors.push({ path: '/runner/cwd', message: `Runner, champ cwd : ${r.error}` })
    }
  }

  const seen = new Map<string, number>()
  parcours.steps.forEach((step, i) => {
    const at = `Étape ${step.id}`

    const first = seen.get(step.id)
    if (first !== undefined) {
      errors.push({
        path: `/steps/${i}/id`,
        message: `${at} : cet identifiant est déjà utilisé par l'étape n°${first + 1}, chaque étape doit avoir un id unique`,
      })
    } else {
      seen.set(step.id, i)
    }

    // Vitest filtre sur le nom complet du test, `describe` inclus : le grep doit donc
    // reprendre « step <id> », sinon le filtre attrape zéro ou trop de tests. pytest filtre
    // par fichier ; le champ y reste exigé, pour qu'un parcours ait la même forme partout.
    const expectedGrep = `step ${step.id}`
    if (step.tests.grep.trim() === '') {
      errors.push({ path: `/steps/${i}/tests/grep`, message: `${at} : le champ tests.grep est vide` })
    } else if (!step.tests.grep.includes(expectedGrep)) {
      errors.push({
        path: `/steps/${i}/tests/grep`,
        message: `${at} : le champ tests.grep vaut « ${step.tests.grep} » mais doit contenir « ${expectedGrep} »${kind === 'vitest' ? ' pour que le filtre de Vitest cible cette étape' : ''}`,
      })
    }

    // pytest importe chaque fichier de test comme un module : « step-1.1.py » n'est pas un
    // nom de module, et un point dans le nom casse aussi la relecture du rapport JUnit.
    const base = step.tests.file.split('/').pop() ?? ''
    if (kind === 'pytest' && !/^[A-Za-z_][A-Za-z0-9_]*\.py$/.test(base)) {
      errors.push({
        path: `/steps/${i}/tests/file`,
        message: `${at} : avec pytest, le fichier de test doit être un module Python : « ${base} » ne l'est pas, écris par exemple « test_step_${step.id.replace(/[^A-Za-z0-9_]/g, '_')}.py » (lettres, chiffres et _ seulement, extension .py)`,
      })
    }

    if (!step.tests.file.startsWith(TESTS_DIR)) {
      errors.push({
        path: `/steps/${i}/tests/file`,
        message: `${at} : le fichier de test « ${step.tests.file} » doit être placé dans ${TESTS_DIR}`,
      })
    }
    const testFile = safeResolve(VALIDATION_ROOT, step.tests.file)
    if (!testFile.ok) {
      errors.push({ path: `/steps/${i}/tests/file`, message: `${at}, tests.file : ${testFile.error}` })
    }

    step.expected.files.forEach((file, j) => {
      const r = safeResolve(VALIDATION_ROOT, file)
      if (!r.ok) {
        errors.push({ path: `/steps/${i}/expected/files/${j}`, message: `${at}, expected.files : ${r.error}` })
      }
    })

    const declared = new Set(step.expected.files)
    for (const file of Object.keys(step.solution)) {
      const r = safeResolve(VALIDATION_ROOT, file)
      if (!r.ok) {
        errors.push({ path: `/steps/${i}/solution`, message: `${at}, solution : ${r.error}` })
        continue
      }
      if (!declared.has(file)) {
        errors.push({
          path: `/steps/${i}/solution`,
          message: `${at} : la solution écrit « ${file} », qui n'est pas listé dans expected.files (${step.expected.files.join(', ')})`,
        })
      }
    }
  })

  return errors
}

// --- Traduction des erreurs ajv --------------------------------------------------------

function translate(error: ErrorObject, raw: unknown): ValidationError {
  const path = error.instancePath
  return { path, message: `${prefix(path, raw)}${reason(error)}` }
}

/** « Étape 1.3 : » quand l'erreur est dans une étape, sinon rien. */
function prefix(instancePath: string, raw: unknown): string {
  const match = /^\/steps\/(\d+)/.exec(instancePath)
  if (!match?.[1]) return ''
  const index = Number(match[1])
  const id = stepId(raw, index)
  return id === undefined ? `Étape n°${index + 1} : ` : `Étape ${id} : `
}

function stepId(raw: unknown, index: number): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const steps = (raw as { steps?: unknown }).steps
  if (!Array.isArray(steps)) return undefined
  const step: unknown = steps[index]
  if (typeof step !== 'object' || step === null) return undefined
  const id = (step as { id?: unknown }).id
  return typeof id === 'string' ? id : undefined
}

/** Les messages ajv sont en anglais et hors contexte : on les réécrit entièrement. */
function reason(error: ErrorObject): string {
  const field = fieldName(error.instancePath)
  switch (error.keyword) {
    case 'required': {
      const missing = (error.params as { missingProperty: string }).missingProperty
      const where = field === '' ? 'la racine du parcours' : `le champ « ${field} »`
      return `le champ « ${missing} » est obligatoire et absent de ${where}`
    }
    case 'additionalProperties': {
      const extra = (error.params as { additionalProperty: string }).additionalProperty
      return `le champ « ${extra} » n'existe pas dans le format v1${field === '' ? '' : ` (dans « ${field} »)`}`
    }
    case 'const':
      return `le champ « ${field} » doit valoir exactement ${JSON.stringify((error.params as { allowedValue: unknown }).allowedValue)}`
    case 'enum':
      return `le champ « ${field} » doit valoir l'une de ces valeurs : ${(error.params as { allowedValues: unknown[] }).allowedValues.map((v) => JSON.stringify(v)).join(', ')}`
    case 'type':
      return `le champ « ${field} » doit être de type ${frenchType((error.params as { type: string }).type)}`
    case 'minLength':
      return `le champ ${field} est vide`
    case 'maxLength':
      return `le champ « ${field} » dépasse ${(error.params as { limit: number }).limit} caractères`
    case 'minItems': {
      const limit = (error.params as { limit: number }).limit
      return error.instancePath === '/steps'
        ? `le parcours ne contient aucune étape, il en faut entre 1 et 20`
        : `le champ « ${field} » doit contenir au moins ${limit} élément(s)`
    }
    case 'maxItems': {
      const limit = (error.params as { limit: number }).limit
      return error.instancePath === '/steps'
        ? `le parcours contient trop d'étapes, le maximum est ${limit}`
        : `le champ « ${field} » ne doit pas dépasser ${limit} élément(s)`
    }
    case 'minProperties':
      return `le champ « ${field} » est vide, il doit contenir au moins ${(error.params as { limit: number }).limit} entrée(s)`
    case 'pattern':
      return patternReason(field)
    default:
      return `le champ « ${field === '' ? 'racine' : field} » est invalide (${error.message ?? error.keyword})`
  }
}

function patternReason(field: string): string {
  if (field === 'slug') {
    return 'le champ « slug » doit être en kebab-case : minuscules, chiffres et tirets simples (ex. « auth-jwt »)'
  }
  if (field.endsWith('id')) {
    return `le champ « ${field} » doit être un identifiant simple, sans espace ni caractère spécial (ex. « 1.3 »)`
  }
  return `le champ « ${field} » ne respecte pas le format attendu`
}

function frenchType(type: string): string {
  const types: Readonly<Record<string, string>> = {
    string: 'chaîne de caractères',
    number: 'nombre',
    integer: 'nombre entier',
    boolean: 'booléen',
    array: 'tableau',
    object: 'objet',
    null: 'null',
  }
  return types[type] ?? type
}

/** `/steps/2/tests/grep` → `tests.grep`, `/slug` → `slug`. */
function fieldName(instancePath: string): string {
  return instancePath
    .split('/')
    .slice(1)
    .filter((segment) => segment !== 'steps' && !/^\d+$/.test(segment))
    .join('.')
}

function dedupe(errors: readonly ValidationError[]): ValidationError[] {
  const seen = new Set<string>()
  return errors.filter((e) => {
    const key = `${e.path}|${e.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
