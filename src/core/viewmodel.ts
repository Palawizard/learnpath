import type { Parcours, Step } from './parcours.js'
import type { Outcome, Regression } from './progression.js'
import type { ParcoursState } from './state.js'
import type { Classification } from '../runner/classify.js'
import { humanize, phaseOf } from './humanize.js'

/**
 * Ce que le panneau affiche, décrit sans une ligne de HTML et sans `vscode`. La webview
 * ne fait que rendre cette structure : tout ce qui se décide (quel rouge, quels indices,
 * quelle progression) se décide ici, où c'est testable.
 */

/** Zone d'état du dernier run. Les quatre `kind` sont les quatre lignes de `UX.md`. */
export interface StatusView {
  /** `none` : rien du tout à l'écran. C'est l'état normal en début d'étape. */
  readonly kind: 'none' | 'progress' | 'failed' | 'passed'
  /** Phrase principale. Vide quand `kind` vaut `none`. */
  readonly summary: string
  /** Détail brut : message de parse, ou message d'assertion sans sa pile d'appels. */
  readonly detail?: string
  /**
   * Traduction en français de `detail`, quand la forme est reconnue. Elle s'ajoute au
   * brut, elle ne le remplace jamais : voir `humanize.ts`.
   */
  readonly explained?: string
  /** `fullName` du test en échec. */
  readonly testName?: string
  /** Le run vient de faire passer à l'étape suivante : transition verte brève. */
  readonly advanced: boolean
}

/** Bandeau distinct. Jamais fusionné avec `status` : ce n'est pas l'étape courante. */
export interface RegressionView {
  readonly stepId: string
  readonly stepTitle: string
  readonly testFile: string
  readonly testName?: string
  readonly detail?: string
  readonly explained?: string
}

export interface RecapStepView {
  readonly id: string
  readonly title: string
  readonly hints: number
  readonly solution: boolean
}

export interface ViewModel {
  readonly parcoursTitle: string
  readonly stepId: string
  readonly stepTitle: string
  /** 1-based, pour « Étape n / N ». */
  readonly position: number
  readonly total: number
  /** Étapes acquises sur le total, en pourcentage entier. */
  readonly percent: number
  /** Markdown brut, tel qu'il vient du parcours. Le rendu est fait par la webview. */
  readonly explanation: string
  readonly expectedFiles: readonly string[]
  readonly contract?: string
  readonly acceptance: readonly string[]
  /** Indices déjà révélés, dans l'ordre du parcours. */
  readonly hints: readonly string[]
  readonly hintsRemaining: number
  readonly solutionRevealed: boolean
  readonly status: StatusView
  /**
   * Un run est en cours (le debounce est passé). Ce qui est affiché dans la zone d'état
   * date de la tentative précédente : il doit se voir comme périmé, pas comme à jour.
   */
  readonly running: boolean
  readonly regressions: readonly RegressionView[]
  readonly finished: boolean
  /** Vide tant que le parcours n'est pas terminé. */
  readonly recap: readonly RecapStepView[]
}

/**
 * `state` fait foi pour l'étape affichée, `outcome` pour la zone d'état. Les deux peuvent
 * porter sur des étapes différentes : après une avancée, on affiche l'étape 1.2 pendant
 * que la zone d'état dit encore « Étape 1.1 validée ». C'est voulu.
 *
 * Retourne `undefined` si le state pointe une étape absente du parcours — le message
 * d'erreur correspondant est déjà celui de `runCurrentStep`.
 */
export function buildViewModel(
  parcours: Parcours,
  state: ParcoursState,
  outcome?: Outcome,
  running = false
): ViewModel | undefined {
  const index = parcours.steps.findIndex((s) => s.id === state.currentStepId)
  const step = parcours.steps[index]
  if (step === undefined) return undefined

  const total = parcours.steps.length
  const finished = state.completedAt !== undefined
  const done = finished ? total : index

  return {
    parcoursTitle: parcours.title,
    stepId: step.id,
    stepTitle: step.title,
    position: index + 1,
    total,
    percent: Math.round((done / total) * 100),
    explanation: step.explanation,
    expectedFiles: step.expected.files,
    ...(step.expected.contract === undefined ? {} : { contract: step.expected.contract }),
    acceptance: step.expected.acceptance ?? [],
    hints: revealedHints(step, state),
    hintsRemaining: (step.hints?.length ?? 0) - (state.hintsRevealed[step.id] ?? 0),
    solutionRevealed: state.solutionsRevealed.includes(step.id),
    status: statusOf(outcome),
    running,
    regressions: (outcome?.regressions ?? []).map(regressionView),
    finished,
    recap: finished ? parcours.steps.map((s) => recapView(s, state)) : [],
  }
}

function revealedHints(step: Step, state: ParcoursState): readonly string[] {
  return (step.hints ?? []).slice(0, state.hintsRevealed[step.id] ?? 0)
}

function recapView(step: Step, state: ParcoursState): RecapStepView {
  return {
    id: step.id,
    title: step.title,
    hints: state.hintsRevealed[step.id] ?? 0,
    solution: state.solutionsRevealed.includes(step.id),
  }
}

function statusOf(outcome: Outcome | undefined): StatusView {
  if (outcome === undefined) return { kind: 'none', summary: '', advanced: false }
  const { result } = outcome
  const advanced = outcome.advanced

  switch (result.state) {
    // Rien du tout : afficher une erreur ici est faux et décourageant (UX.md).
    case 'missing-file':
      return { kind: 'none', summary: '', advanced: false }
    case 'collect-error':
      return {
        kind: 'progress',
        summary: outcome.summary,
        ...detailOf(result),
        advanced: false,
      }
    case 'assertion-failed': {
      const failure = result.failures[0]
      return {
        kind: 'failed',
        summary: outcome.summary,
        ...(failure === undefined ? {} : { testName: failure.fullName }),
        ...detailOf(result),
        advanced: false,
      }
    }
    case 'pass':
      return { kind: 'passed', summary: outcome.summary, advanced }
  }
}

function regressionView(regression: Regression): RegressionView {
  const failure = regression.result.failures[0]
  return {
    stepId: regression.step.id,
    stepTitle: regression.step.title,
    testFile: regression.step.tests.file,
    ...(failure === undefined ? {} : { testName: failure.fullName }),
    ...detailOf(regression.result),
  }
}

/**
 * Le brut d'abord, la traduction ensuite : `explained` n'est présent que si `humanize`
 * reconnaît la forme, et `detail` est toujours là. Un message non reconnu s'affiche seul,
 * tel quel.
 */
function detailOf(result: Classification): { detail?: string; explained?: string } {
  if (result.message === undefined) return {}
  const detail = firstLines(result.message)
  const explained = humanize(result.message, phaseOf(result.state))
  return { detail, ...(explained === undefined ? {} : { explained }) }
}

/**
 * Un message d'assertion Vitest, c'est « expected [ 1 ] to deeply equal [] » suivi d'une
 * pile d'appels qui pointe dans `node_modules`. On garde la partie lisible et on jette la
 * pile : elle n'aide personne à comprendre pourquoi son code ne passe pas.
 */
function firstLines(message: string): string {
  const lines: string[] = []
  for (const line of message.split('\n')) {
    if (/^\s+at\s/.test(line)) break
    lines.push(line)
  }
  return lines.join('\n').trim()
}
