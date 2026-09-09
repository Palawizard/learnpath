import { type Result, ok, err } from './result.js'
import { type ResolvedPath, safeResolve } from './paths.js'
import { writeFileAtomic } from './atomic.js'
import type { Step } from './parcours.js'
import { type Session, currentStep } from './progression.js'
import { revealHint, revealSolution, writeState } from './state.js'

/**
 * Les deux gestes de l'utilisateur qui touchent le state depuis le panneau. Ils sont ici
 * plutôt que dans la webview parce qu'ils écrivent sur disque : c'est du code qui doit
 * être testé, et la webview n'est pas un endroit où on teste quoi que ce soit.
 */

/** Un indice à la fois, dans l'ordre du parcours. Un indice révélé le reste. */
export async function revealNextHint(session: Session): Promise<Result<Session>> {
  const step = currentStep(session)
  if (step === undefined) {
    return err(`L'étape « ${session.state.currentStepId} » n'existe pas dans le parcours.`)
  }
  const available = step.hints?.length ?? 0
  if ((session.state.hintsRevealed[step.id] ?? 0) >= available) {
    return err(`L'étape ${step.id} n'a plus d'indice à révéler.`)
  }

  const state = revealHint(session.state, step.id)
  await writeState(session.stateFile, state)
  return ok({ ...session, state })
}

export interface SolutionApplied {
  readonly session: Session
  /** Chemins relatifs écrits, pour l'affichage. */
  readonly files: readonly string[]
}

export interface SolutionTarget {
  /** Chemin relatif, tel qu'il est écrit dans le parcours. */
  readonly file: string
  readonly path: ResolvedPath
  readonly content: string
}

/**
 * Les deux garde-fous de la solution, **avant** la moindre écriture : chaque fichier doit
 * être déclaré dans `expected.files` de cette étape-là, et chaque chemin repasse par
 * `safeResolve` contre la racine réelle. Le parcours a beau avoir été validé à l'import,
 * il est relu depuis le disque à chaque session : on ne lui refait pas confiance sur
 * parole. `verifyAllGreen` passe par ici aussi, contre sa copie temporaire.
 */
export function planSolution(root: string, step: Step): Result<readonly SolutionTarget[]> {
  const declared = new Set(step.expected.files)
  const targets: SolutionTarget[] = []
  for (const [file, content] of Object.entries(step.solution)) {
    if (!declared.has(file)) {
      return err(
        `La solution de l'étape ${step.id} veut écrire « ${file} », qui n'est pas listé dans expected.files (${step.expected.files.join(', ')}). Rien n'a été écrit.`
      )
    }
    const target = safeResolve(root, file)
    if (!target.ok) {
      return err(`Solution de l'étape ${step.id} : ${target.error}. Rien n'a été écrit.`)
    }
    targets.push({ file, path: target.value, content })
  }
  if (targets.length === 0) {
    return err(`L'étape ${step.id} n'a pas de solution enregistrée.`)
  }
  return ok(targets)
}

/** Écrit la solution de l'étape courante, après `planSolution`. */
export async function applySolution(session: Session): Promise<Result<SolutionApplied>> {
  const step = currentStep(session)
  if (step === undefined) {
    return err(`L'étape « ${session.state.currentStepId} » n'existe pas dans le parcours.`)
  }

  const targets = planSolution(session.root, step)
  if (!targets.ok) return targets

  for (const target of targets.value) await writeFileAtomic(target.path, target.content)

  const state = revealSolution(session.state, step.id)
  await writeState(session.stateFile, state)
  return ok({ session: { ...session, state }, files: targets.value.map((t) => t.file) })
}
