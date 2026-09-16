import type { Parcours, Scope, Step, StepExample } from './parcours.js'
import { type DiffLine, diffLines } from './diff.js'
import { contentBefore } from './pedagogy.js'
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

/** Un fichier de la solution ou du squelette, tel qu'il s'affiche dans le panneau (D34). */
export interface SolutionFileView {
  readonly file: string
  /** Le fichier complet : c'est lui qui est copié. */
  readonly content: string
  /**
   * Ce que l'étape change par rapport au fichier d'avant elle (D41). Absent quand le fichier
   * est créé par l'étape : tout est nouveau, le diff n'apprendrait rien de plus.
   */
  readonly diff?: readonly DiffLine[]
}

/** Le test de l'étape, montré tel quel : les textes et rôles exacts n'ont plus à se deviner. */
export interface TestSourceView {
  readonly file: string
  readonly content: string
}

/** Ce que « refaire cette étape » ferait, ou pourquoi c'est indisponible (D36). */
export interface RedoView {
  readonly stepId: string
  /** Les fichiers qui seraient remplacés. Aucun autre ne peut l'être. */
  readonly files: readonly string[]
  readonly available: boolean
  /** Toujours présent quand `available` est faux : la phrase à afficher telle quelle. */
  readonly reason?: string
}

/**
 * Relecture d'une étape passée. C'est un mode **en lecture seule** : ni indice, ni
 * solution, ni run — rien n'est touché tant que l'utilisateur ne demande pas explicitement
 * de refaire l'étape, ce qui est le seul geste destructif et passe par une confirmation.
 */
export interface ReviewView {
  readonly previousStepId?: string
  readonly nextStepId?: string
  readonly redo: RedoView
}

export interface RecapStepView {
  readonly id: string
  readonly title: string
  readonly hints: number
  readonly solution: boolean
  readonly scaffold: boolean
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
  /** Intro et périmètre du parcours (D42). Montrés repliés, ouverts à la première étape. */
  readonly intro?: string
  readonly scope?: Scope
  /** Exemples résolus de la syntaxe de l'étape (D40). */
  readonly examples: readonly StepExample[]
  /** Fichier dont l'extension sert à colorer les exemples. */
  readonly languageFile: string
  readonly test: TestSourceView
  readonly expectedFiles: readonly string[]
  readonly contract?: string
  readonly acceptance: readonly string[]
  /** Indices déjà révélés, dans l'ordre du parcours. */
  readonly hints: readonly string[]
  readonly hintsRemaining: number
  readonly solutionRevealed: boolean
  /**
   * Contenu de la solution, un bloc par fichier. Vide tant qu'elle n'est pas révélée : on
   * ne pousse pas au panneau ce que l'utilisateur n'a pas demandé à voir.
   */
  readonly solution: readonly SolutionFileView[]
  /** L'étape a un squelette à proposer (D41). */
  readonly scaffoldAvailable: boolean
  readonly scaffoldRevealed: boolean
  /** Vide tant que le squelette n'est pas affiché. */
  readonly scaffold: readonly SolutionFileView[]
  /**
   * La solution de cette étape **et** de la précédente ont été affichées : les étapes sont
   * peut-être trop grosses pour le niveau choisi. Le panneau le dit, sans juger.
   */
  readonly pacingNotice: boolean
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
  /**
   * Étape courante du parcours (1-based), même en relecture : la barre de progression
   * montre toujours où on en est vraiment, pas où on est en train de lire.
   */
  readonly currentPosition: number
  /**
   * Étape par laquelle s'ouvre la relecture : la dernière validée. Absent quand il n'y a
   * rien à relire, ou qu'on est déjà en relecture.
   */
  readonly reviewEntry?: string
  /** Présent uniquement en relecture. `readOnly` en découle. */
  readonly review?: ReviewView
  readonly readOnly: boolean
}

/** Ce que l'appelant sait de la relecture en cours. Voir `src/watcher.ts`. */
export interface ReviewInput {
  readonly stepId: string
  readonly redo: RedoView
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
  running = false,
  review?: ReviewInput
): ViewModel | undefined {
  const current = parcours.steps.findIndex((s) => s.id === state.currentStepId)
  if (parcours.steps[current] === undefined) return undefined

  const total = parcours.steps.length
  const finished = state.completedAt !== undefined
  const done = finished ? total : current
  // En relecture, l'étape affichée n'est pas celle du state : seule elle change, la
  // progression réelle reste celle du parcours. Une étape non validée ne se relit pas —
  // on retombe alors sur l'étape courante plutôt que d'inventer un mode de plus.
  const asked = review === undefined ? -1 : parcours.steps.findIndex((s) => s.id === review.stepId)
  const reviewing = asked >= 0 && asked < done
  const index = reviewing ? asked : current
  const step = parcours.steps[index]
  if (step === undefined) return undefined
  const solutionRevealed = state.solutionsRevealed.includes(step.id)
  const scaffoldRevealed = state.scaffoldsRevealed.includes(step.id)
  const previous = parcours.steps[index - 1]

  return {
    parcoursTitle: parcours.title,
    stepId: step.id,
    stepTitle: step.title,
    position: index + 1,
    total,
    percent: Math.round((done / total) * 100),
    explanation: step.explanation,
    ...(parcours.intro === undefined ? {} : { intro: parcours.intro }),
    ...(parcours.scope === undefined ? {} : { scope: parcours.scope }),
    examples: step.examples ?? [],
    languageFile: step.expected.files[0] ?? '',
    test: { file: step.tests.file, content: step.tests.content },
    expectedFiles: step.expected.files,
    ...(step.expected.contract === undefined ? {} : { contract: step.expected.contract }),
    acceptance: step.expected.acceptance ?? [],
    hints: revealedHints(step, state),
    hintsRemaining: reviewing ? 0 : (step.hints?.length ?? 0) - (state.hintsRevealed[step.id] ?? 0),
    solutionRevealed,
    solution: solutionRevealed ? filesView(parcours, index, step.solution) : [],
    scaffoldAvailable: Object.keys(step.scaffold ?? {}).length > 0,
    scaffoldRevealed,
    scaffold: scaffoldRevealed ? filesView(parcours, index, step.scaffold ?? {}) : [],
    pacingNotice:
      !reviewing && solutionRevealed && previous !== undefined && state.solutionsRevealed.includes(previous.id),
    // La zone d'état décrit le dernier run, donc l'étape courante : l'afficher à côté
    // d'une étape passée la ferait lire comme le résultat de celle-là.
    status: reviewing ? { kind: 'none', summary: '', advanced: false } : statusOf(outcome),
    running: reviewing ? false : running,
    regressions: reviewing ? [] : (outcome?.regressions ?? []).map(regressionView),
    finished: finished && !reviewing,
    recap: finished && !reviewing ? parcours.steps.map((s) => recapView(s, state)) : [],
    currentPosition: finished ? total : current + 1,
    ...(reviewing || done === 0 ? {} : { reviewEntry: parcours.steps[done - 1]?.id ?? '' }),
    ...(reviewing && review !== undefined ? { review: reviewView(parcours, index, done, review.redo) } : {}),
    readOnly: reviewing,
  }
}

/**
 * Bornes de la navigation : on ne se déplace que dans les étapes **validées**. Au-delà,
 * il n'y a rien à relire, il y a le parcours en cours — d'où le retour à l'étape courante
 * plutôt qu'une étape « suivante » qui n'est pas encore jouée.
 */
function reviewView(parcours: Parcours, index: number, done: number, redo: RedoView): ReviewView {
  const previous = parcours.steps[index - 1]
  const next = index + 1 < done ? parcours.steps[index + 1] : undefined
  return {
    ...(previous === undefined ? {} : { previousStepId: previous.id }),
    ...(next === undefined ? {} : { nextStepId: next.id }),
    redo,
  }
}

function revealedHints(step: Step, state: ParcoursState): readonly string[] {
  return (step.hints ?? []).slice(0, state.hintsRevealed[step.id] ?? 0)
}

function filesView(
  parcours: Parcours,
  index: number,
  files: Readonly<Record<string, string>>
): readonly SolutionFileView[] {
  return Object.entries(files).map(([file, content]) => {
    const before = contentBefore(parcours, index, file)
    return before === '' ? { file, content } : { file, content, diff: diffLines(before, content) }
  })
}

function recapView(step: Step, state: ParcoursState): RecapStepView {
  return {
    id: step.id,
    title: step.title,
    hints: state.hintsRevealed[step.id] ?? 0,
    solution: state.solutionsRevealed.includes(step.id),
    scaffold: state.scaffoldsRevealed.includes(step.id),
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
