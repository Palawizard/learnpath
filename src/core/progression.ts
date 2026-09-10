import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { type Result, ok, err } from './result.js'
import { type ResolvedPath, safeResolve } from './paths.js'
import { type Parcours, type Step, loadParcours } from './parcours.js'
import { type ParcoursState, advanceTo, complete, readState, writeState } from './state.js'
import { type Classification, classify } from '../runner/classify.js'
import type { RawResult } from '../runner/parse.js'
import { run } from '../runner/vitest.js'
import { recordCheckpoint } from './redo.js'

/**
 * Tout ce qu'il faut pour jouer un parcours, résolu une seule fois. `src/watcher.ts` en
 * garde un et le remplace à chaque avancée : la logique ci-dessous ne touche jamais
 * `vscode`, elle est donc testable telle quelle.
 */
export interface Session {
  readonly parcours: Parcours
  readonly root: ResolvedPath
  readonly stateFile: ResolvedPath
  /** `runner.cwd` résolu. */
  readonly cwd: ResolvedPath
  readonly state: ParcoursState
}

export interface Regression {
  readonly step: Step
  readonly result: Classification
}

export interface Outcome {
  /** L'étape jouée, c'est-à-dire celle du state au moment du run. */
  readonly step: Step
  readonly result: Classification
  /** Étapes précédentes qui ne passent plus. Jamais présentées comme un échec de `step`. */
  readonly regressions: readonly Regression[]
  /** State après le run, déjà écrit sur disque s'il a changé. */
  readonly state: ParcoursState
  readonly advanced: boolean
  readonly finished: boolean
  /** Le point de restauration git de l'étape validée n'a pas pu être posé (D36). */
  readonly checkpointError?: string
  /** Phrase de la zone d'état. Vide quand il n'y a rien à dire (voir docs/UX.md). */
  readonly summary: string
}

export type Execute = (
  root: ResolvedPath,
  stepIds: readonly string[],
  options: { readonly signal?: AbortSignal; readonly cwd?: ResolvedPath }
) => Promise<Result<RawResult>>

export interface StepRunOptions {
  readonly signal?: AbortSignal
  /** `learnpath.autoAdvance`. À `false`, l'étape est validée mais le state ne bouge pas. */
  readonly autoAdvance?: boolean
  /** `learnpath.gitCheckpoints`. À `false`, aucun commit n'est créé (D36). */
  readonly gitCheckpoints?: boolean
  readonly execute?: Execute
}

// --- Chargement ------------------------------------------------------------------------

/**
 * Le parcours importé, relu depuis `.learn/parcours/`. Séparé de `loadSession` parce que
 * la réinitialisation en a besoin **sans** le state : un `state.json` illisible est
 * justement le cas où l'utilisateur lance « Réinitialiser ».
 */
export async function readImportedParcours(workspaceRoot: string): Promise<Result<Parcours>> {
  const parcoursDir = safeResolve(workspaceRoot, '.learn/parcours')
  if (!parcoursDir.ok) return err(parcoursDir.error)

  let entries: string[]
  try {
    entries = (await fs.readdir(parcoursDir.value)).filter((name) => name.endsWith('.json'))
  } catch {
    return err("Aucun parcours importé dans ce projet : le dossier .learn/parcours est introuvable.")
  }
  const name = entries[0]
  if (name === undefined) return err("Aucun parcours importé dans ce projet.")

  const file = safeResolve(workspaceRoot, `.learn/parcours/${name}`)
  if (!file.ok) return err(file.error)

  let raw: unknown
  try {
    raw = JSON.parse(await fs.readFile(file.value, 'utf8'))
  } catch {
    return err(`Le parcours .learn/parcours/${name} est illisible.`)
  }
  const parcours = loadParcours(raw)
  if (!parcours.ok) {
    return err(
      `Le parcours .learn/parcours/${name} n'est plus valide : ${parcours.error.map((e) => e.message).join(' ; ')}`
    )
  }
  return ok(parcours.value)
}

/** Charge le parcours importé et sa progression. Aucune écriture. */
export async function loadSession(workspaceRoot: string): Promise<Result<Session>> {
  const root = safeResolve(workspaceRoot, '.', { allowRoot: true })
  const stateFile = safeResolve(workspaceRoot, '.learn/state.json')
  if (!root.ok) return err(root.error)
  if (!stateFile.ok) return err(stateFile.error)

  const parcours = await readImportedParcours(workspaceRoot)
  if (!parcours.ok) return parcours

  const state = await readState(stateFile.value)
  if (!state.ok) return err(state.error)

  const cwd = safeResolve(workspaceRoot, parcours.value.runner.cwd ?? '.', { allowRoot: true })
  if (!cwd.ok) return err(`Runner, champ cwd : ${cwd.error}`)

  return ok({
    parcours: parcours.value,
    root: root.value,
    stateFile: stateFile.value,
    cwd: cwd.value,
    state: state.value,
  })
}

// --- Filtrage des sauvegardes ------------------------------------------------------------

export function currentStep(session: Session): Step | undefined {
  return session.parcours.steps.find((step) => step.id === session.state.currentStepId)
}

/**
 * Un `expected.files` est une chaîne du parcours, le chemin sauvegardé vient de l'éditeur :
 * les deux ne se comparent pas telles quelles (séparateurs, casse du lecteur, `./`). On
 * résout les deux et on compare les chemins résolus.
 */
export function isWatched(session: Session, savedFile: string): boolean {
  const step = currentStep(session)
  if (step === undefined || session.state.completedAt !== undefined) return false

  const saved = path.resolve(savedFile)
  return step.expected.files.some((file) => {
    const target = safeResolve(session.root, file)
    return target.ok && path.relative(target.value, saved) === ''
  })
}

// --- Boucle de progression ---------------------------------------------------------------

/**
 * Un seul chemin de code : la sauvegarde et `learnpath.runStep` appellent tous les deux
 * ceci. Lance l'étape courante **et** toutes les précédentes (régression), classe chaque
 * étape, avance le state si c'est légitime, et l'écrit.
 */
export async function runCurrentStep(
  session: Session,
  options: StepRunOptions = {}
): Promise<Result<Outcome>> {
  const steps = session.parcours.steps
  const index = steps.findIndex((step) => step.id === session.state.currentStepId)
  const step = steps[index]
  if (step === undefined) {
    return err(
      `L'étape « ${session.state.currentStepId} » enregistrée dans .learn/state.json n'existe pas dans le parcours.`
    )
  }
  if (session.state.completedAt !== undefined) {
    return err("Le parcours est terminé : il n'y a plus d'étape à jouer.")
  }

  const played = steps.slice(0, index + 1)
  const execute = options.execute ?? run
  const raw = await execute(
    session.root,
    played.map((s) => s.id),
    { ...(options.signal ? { signal: options.signal } : {}), cwd: session.cwd }
  )
  if (!raw.ok) return err(raw.error)

  const result = classify(raw.value, step)
  const regressions = steps
    .slice(0, index)
    .map((previous) => ({ step: previous, result: classify(raw.value, previous) }))
    .filter((r) => r.result.state !== 'pass')

  const next = steps[index + 1]
  const autoAdvance = options.autoAdvance ?? true
  // D16 : une étape précédente cassée met la progression en pause. Les étapes suivantes
  // supposent que les précédentes tiennent ; avancer enverrait l'étudiant chercher son
  // erreur au mauvais endroit.
  const moves = result.state === 'pass' && regressions.length === 0 && autoAdvance

  // L'étape est validée dès que son run passe sans régression : le point de restauration
  // suit ce fait-là, pas l'avancée du state, qui dépend en plus de `autoAdvance`.
  let checkpointError: string | undefined
  if (result.state === 'pass' && regressions.length === 0) {
    const recorded = await recordCheckpoint(session, step, options.gitCheckpoints ?? true)
    if (!recorded.ok) checkpointError = recorded.error
  }

  let state = session.state
  if (moves) state = next === undefined ? complete(state) : advanceTo(state, next.id)
  // Un run annulé n'enregistre rien : son remplaçant est déjà programmé, et la reprise
  // d'étape peut avoir réécrit le state pendant qu'il tournait (D36).
  if (state !== session.state && options.signal?.aborted !== true) {
    await writeState(session.stateFile, state)
  }

  return ok({
    ...(checkpointError === undefined ? {} : { checkpointError }),
    step,
    result,
    regressions,
    state,
    advanced: moves && next !== undefined,
    finished: moves && next === undefined,
    summary: summarize(step, result, regressions, next, autoAdvance, steps.length),
  })
}

function summarize(
  step: Step,
  result: Classification,
  regressions: readonly Regression[],
  next: Step | undefined,
  autoAdvance: boolean,
  total: number
): string {
  if (result.state === 'missing-file') return ''
  if (result.state === 'collect-error') return "Le fichier n'est pas encore valide."
  if (result.state === 'assertion-failed') {
    const failed = result.failures[0]?.fullName
    return failed === undefined ? `Étape ${step.id} : test en échec.` : `Test en échec : ${failed}`
  }

  const blocked = regressions[0]
  if (blocked !== undefined) {
    const others =
      regressions.length > 1 ? ` (et ${regressions.length - 1} autre(s) : ${regressions.slice(1).map((r) => r.step.id).join(', ')})` : ''
    return `Étape ${step.id} validée. En attente : l'étape ${blocked.step.id} ne passe plus depuis ta dernière modification${others}.`
  }
  if (next === undefined) return `Parcours terminé : les ${total} étapes passent.`
  if (!autoAdvance) return `Étape ${step.id} validée. Passe à l'étape ${next.id} quand tu veux.`
  return `Étape ${step.id} validée. Étape suivante : ${next.id} — ${next.title}.`
}

// --- Ordonnancement des runs --------------------------------------------------------------

export interface RunLoopDeps {
  /** Relu à chaque sauvegarde : changer `learnpath.debounceMs` ne demande pas de recharger. */
  readonly debounceMs: () => number
  readonly execute: (signal: AbortSignal) => Promise<void>
}

/**
 * Un seul run vivant à la fois. Une sauvegarde pendant un run annule celui en cours et en
 * relance un — c'est le cas fréquent, quelqu'un qui sauvegarde deux fois de suite — et le
 * nouveau n'est lancé qu'une fois l'ancien terminé, sinon deux processus Vitest se
 * marcheraient dessus.
 */
export class RunLoop {
  private timer: ReturnType<typeof setTimeout> | undefined
  private controller: AbortController | undefined
  private running: Promise<void> = Promise.resolve()

  constructor(private readonly deps: RunLoopDeps) {}

  /** Sauvegarde : debounce. Sans lui on relance les tests pendant que l'utilisateur tape. */
  schedule(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.runNow()
    }, this.deps.debounceMs())
  }

  /** Déclenchement immédiat (`learnpath.runStep`). Annule un debounce en attente. */
  runNow(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }

    this.controller?.abort()
    const previous = this.running
    const mine = new AbortController()
    this.controller = mine

    this.running = (async () => {
      await previous
      if (mine.signal.aborted) return
      await this.deps.execute(mine.signal)
    })().catch(() => undefined)

    return this.running
  }

  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.controller?.abort()
    this.controller = undefined
  }
}
