import { type Result, ok, err } from '../core/result.js'

export interface Assertion {
  /** Nom complet, `describe` inclus : c'est sur lui que porte le filtre `-t`. */
  readonly fullName: string
  readonly status: 'passed' | 'failed' | 'skipped' | 'todo' | 'unknown'
  readonly failureMessages: readonly string[]
}

export interface TestFile {
  /** Chemin absolu du fichier de test, tel que Vitest l'écrit. */
  readonly name: string
  readonly status: 'passed' | 'failed' | 'unknown'
  /** Erreur survenue hors de tout test (collecte, import, syntaxe). Vide sinon. */
  readonly message: string
  readonly assertions: readonly Assertion[]
}

export interface RawResult {
  readonly success: boolean
  readonly numTotalTests: number
  readonly files: readonly TestFile[]
}

/**
 * Le rapport JSON de Vitest est produit par un processus qu'on peut tuer en cours de
 * route : il peut être absent, vide, tronqué, ou complet mais sans le moindre test.
 * Rien de tout ça ne doit lever.
 */
export function parseResult(content: string): Result<RawResult> {
  if (content.trim() === '') {
    return err("le rapport de test est vide : Vitest n'a rien écrit")
  }

  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return err('le rapport de test est illisible (JSON tronqué ou corrompu)')
  }
  if (typeof raw !== 'object' || raw === null) {
    return err("le rapport de test n'est pas un objet JSON")
  }

  const report = raw as Record<string, unknown>
  const results = Array.isArray(report['testResults']) ? report['testResults'] : []

  return ok({
    success: report['success'] === true,
    numTotalTests: typeof report['numTotalTests'] === 'number' ? report['numTotalTests'] : 0,
    files: results.map(readFile),
  })
}

function readFile(raw: unknown): TestFile {
  const file = asObject(raw)
  const assertions = Array.isArray(file['assertionResults']) ? file['assertionResults'] : []
  return {
    name: text(file['name']),
    status: fileStatus(text(file['status'])),
    message: text(file['message']),
    assertions: assertions.map(readAssertion),
  }
}

function readAssertion(raw: unknown): Assertion {
  const assertion = asObject(raw)
  const messages = Array.isArray(assertion['failureMessages']) ? assertion['failureMessages'] : []
  return {
    fullName: text(assertion['fullName']),
    status: assertionStatus(text(assertion['status'])),
    failureMessages: messages.map(text).filter((m) => m !== ''),
  }
}

function fileStatus(value: string): TestFile['status'] {
  return value === 'passed' || value === 'failed' ? value : 'unknown'
}

function assertionStatus(value: string): Assertion['status'] {
  switch (value) {
    case 'passed':
    case 'failed':
    case 'skipped':
    case 'todo':
      return value
    case 'pending':
      return 'skipped'
    default:
      return 'unknown'
  }
}

function asObject(raw: unknown): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
