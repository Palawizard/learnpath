import * as fs from 'node:fs/promises'
import { type Result, ok, err } from './result.js'
import { type ResolvedPath, safeResolve } from './paths.js'
import type { Parcours, Step } from './parcours.js'
import type { Session } from './progression.js'
import { rewindTo, writeState } from './state.js'
import {
  backupRef,
  baseRef,
  commitPaths,
  hasPathInRef,
  headCommit,
  isRefSafe,
  isWorkingTreeClean,
  pathPrefix,
  refCommit,
  repositoryRoot,
  restorePaths,
  stepRef,
  updateRef,
} from './git.js'

/**
 * Refaire une étape déjà validée, avec le code tel qu'il était **avant** elle (D36).
 *
 * Le versionnement n'est pas réimplémenté dans `.learn/` : après chaque étape validée,
 * LearnPath fabrique un commit contenant uniquement les `expected.files` de cette étape et
 * le pose sur `refs/learnpath/<slug>/<stepId>`. La branche de l'utilisateur, son index et
 * son travail en cours ne bougent jamais. Refaire l'étape N, c'est réécrire les
 * `expected.files` de N depuis la référence de l'étape d'avant — et rien d'autre.
 */

/** Ce qu'on fait d'un fichier de l'étape, et rien d'autre ne sera touché. */
export interface RedoTarget {
  /** Chemin relatif au projet, tel qu'il est écrit dans le parcours. */
  readonly file: string
  readonly path: ResolvedPath
  /** `delete` : le fichier n'existait pas avant cette étape, l'annuler c'est le retirer. */
  readonly action: 'restore' | 'delete'
}

export interface RedoPlan {
  readonly step: Step
  /** Référence de l'état d'avant l'étape : celle de l'étape précédente, ou `base`. */
  readonly ref: string
  readonly targets: readonly RedoTarget[]
}

export interface Availability {
  readonly available: boolean
  /** Pourquoi c'est indisponible. Toujours présent quand `available` est faux. */
  readonly reason?: string
}

const DISABLED =
  "L'option « learnpath.gitCheckpoints » est désactivée : LearnPath ne crée aucun commit, et refaire une étape est indisponible."
const NO_REPO =
  "Ce projet n'est pas un dépôt git : LearnPath ne peut pas retrouver le code d'avant une étape."
const NO_BASE =
  "Le parcours a été importé sans point de départ git — pas de dépôt, arbre de travail non propre, ou option désactivée à ce moment-là. Réimporte le parcours dans un dépôt propre pour activer la reprise d'étape."

// --- Import ------------------------------------------------------------------------------

/**
 * Les conditions sont vérifiées **au début de l'import**, avant que le setup n'installe
 * quoi que ce soit : c'est le seul moment où l'arbre de travail décrit encore l'état de
 * départ. Retourne le commit qui servira de base, ou la raison de l'indisponibilité.
 */
export async function checkpointStart(
  root: ResolvedPath,
  parcours: Parcours,
  enabled: boolean
): Promise<{ readonly head?: string; readonly reason?: string }> {
  if (!enabled) return { reason: DISABLED }
  if ((await repositoryRoot(root)) === undefined) return { reason: NO_REPO }

  const head = await headCommit(root)
  if (head === undefined) {
    return {
      reason:
        "Ce dépôt git n'a encore aucun commit : LearnPath n'a pas d'état de départ à mémoriser. Fais un premier commit, puis réimporte le parcours.",
    }
  }
  if (!(await isWorkingTreeClean(root))) {
    return {
      reason:
        "L'arbre de travail n'était pas propre à l'import : LearnPath ne peut pas garantir l'état de départ. Commite ou remise tes modifications, puis réimporte le parcours pour activer la reprise d'étape.",
    }
  }
  if (!isRefSafe(parcours.slug)) {
    return { reason: `Le slug « ${parcours.slug} » ne donne pas un nom de référence git valide.` }
  }
  const unsafe = parcours.steps.find((step) => !isRefSafe(step.id))
  if (unsafe !== undefined) {
    return {
      reason: `L'identifiant d'étape « ${unsafe.id} » ne donne pas un nom de référence git valide : la reprise d'étape est indisponible pour ce parcours.`,
    }
  }
  return { head }
}

/** Pose la référence de départ. Appelé une fois l'import réussi, jamais avant. */
export async function writeBaseRef(
  root: ResolvedPath,
  slug: string,
  head: string
): Promise<Result<void>> {
  return updateRef(root, baseRef(slug), head)
}

// --- Disponibilité -----------------------------------------------------------------------

/** L'état de la fonctionnalité pour ce projet, à afficher tel quel quand elle est coupée. */
export async function checkpointStatus(
  session: Session,
  enabled: boolean
): Promise<Availability> {
  if (!enabled) return { available: false, reason: DISABLED }
  if ((await repositoryRoot(session.root)) === undefined) {
    return { available: false, reason: NO_REPO }
  }
  if ((await refCommit(session.root, baseRef(session.parcours.slug))) === undefined) {
    return { available: false, reason: NO_BASE }
  }
  return { available: true }
}

// --- Après une étape validée --------------------------------------------------------------

/**
 * Le commit de l'étape qui vient d'être validée. Best effort : une erreur git n'a pas à
 * casser la progression, elle remonte à l'appelant qui la journalise. La chaîne est
 * volontairement stricte — sans le commit de l'étape précédente, on n'en fabrique pas un
 * qui ferait croire à un état d'avant qui n'a jamais existé.
 */
export async function recordCheckpoint(
  session: Session,
  step: Step,
  enabled: boolean
): Promise<Result<void>> {
  if (!enabled) return ok(undefined)
  const status = await checkpointStatus(session, enabled)
  if (!status.available) return ok(undefined)

  const parent = await parentRef(session, step)
  if (!parent.ok) return parent

  const commit = await commitPaths(session.root, {
    parent: parent.value,
    files: [...step.expected.files],
    message: `LearnPath — étape ${step.id} : ${step.title}`,
  })
  if (!commit.ok) return commit
  return updateRef(session.root, stepRef(session.parcours.slug, step.id), commit.value)
}

/** Référence de l'état d'avant cette étape. */
async function parentRef(session: Session, step: Step): Promise<Result<string>> {
  const slug = session.parcours.slug
  const steps = session.parcours.steps
  const index = steps.findIndex((s) => s.id === step.id)
  const previous = index > 0 ? steps[index - 1] : undefined
  const ref = previous === undefined ? baseRef(slug) : stepRef(slug, previous.id)
  if ((await refCommit(session.root, ref)) === undefined) {
    return err(
      previous === undefined
        ? `Le point de départ git du parcours (${ref}) est introuvable.`
        : `Le point de restauration de l'étape ${previous.id} est introuvable : la reprise de l'étape ${step.id} restera indisponible.`
    )
  }
  return ok(ref)
}

// --- Refaire une étape ----------------------------------------------------------------------

/**
 * Ce qui serait remplacé, sans rien écrire. Le plan est ce qu'on montre dans la
 * confirmation : la liste exacte des fichiers, et pour chacun s'il est réécrit ou retiré.
 */
export async function planRedo(
  session: Session,
  stepId: string,
  enabled: boolean
): Promise<Result<RedoPlan>> {
  const status = await checkpointStatus(session, enabled)
  if (!status.available) return err(status.reason ?? NO_BASE)

  const steps = session.parcours.steps
  const index = steps.findIndex((s) => s.id === stepId)
  const step = steps[index]
  if (step === undefined) return err(`L'étape « ${stepId} » n'existe pas dans ce parcours.`)
  if (index >= validatedCount(session)) {
    return err(`L'étape ${stepId} n'est pas encore validée : il n'y a rien à refaire.`)
  }

  const previous = index > 0 ? steps[index - 1] : undefined
  const ref = previous === undefined ? baseRef(session.parcours.slug) : stepRef(session.parcours.slug, previous.id)
  if ((await refCommit(session.root, ref)) === undefined) {
    return err(
      `LearnPath n'a pas de point de restauration pour l'état d'avant l'étape ${stepId} : elle a été validée alors que les points de restauration étaient indisponibles.`
    )
  }

  const prefix = await pathPrefix(session.root)
  const targets: RedoTarget[] = []
  for (const file of step.expected.files) {
    const target = safeResolve(session.root, file)
    if (!target.ok) return err(`Étape ${stepId}, expected.files : ${target.error}. Rien n'a été touché.`)
    targets.push({
      file,
      path: target.value,
      action: (await hasPathInRef(session.root, ref, `${prefix}${file}`)) ? 'restore' : 'delete',
    })
  }
  if (targets.length === 0) return err(`L'étape ${stepId} ne déclare aucun fichier à refaire.`)

  return ok({ step, ref, targets })
}

/**
 * Exécute le plan, et **uniquement** le plan : chaque chemin vient de `expected.files` de
 * cette étape, repassé par `safeResolve`. Un instantané du contenu actuel de ces fichiers
 * est posé sous `refs/learnpath-backup/` juste avant : rien de ce qui est remplacé n'est
 * hors de portée de git.
 *
 * L'appelant a la responsabilité d'avoir traité les éditeurs modifiés non sauvegardés
 * avant d'arriver ici — VSCode ne recharge pas un buffer modifié (D34, D36).
 */
export async function applyRedo(session: Session, plan: RedoPlan): Promise<Result<Session>> {
  const backup = await snapshot(session, plan)
  if (!backup.ok) return backup

  const restore = plan.targets.filter((t) => t.action === 'restore').map((t) => t.file)
  const restored = await restorePaths(session.root, plan.ref, restore)
  if (!restored.ok) return restored

  for (const target of plan.targets) {
    if (target.action === 'delete') await fs.rm(target.path, { force: true })
  }

  const state = rewindTo(session.state, plan.step.id)
  await writeState(session.stateFile, state)
  return ok({ ...session, state })
}

/**
 * Le contenu actuel des fichiers de l'étape, mis de côté avant de les remplacer. Sans lui,
 * « git rattrape tout » serait faux pour la dernière tentative de l'utilisateur, qui n'a
 * jamais été commitée nulle part.
 */
async function snapshot(session: Session, plan: RedoPlan): Promise<Result<void>> {
  const present: string[] = []
  for (const target of plan.targets) {
    if (await exists(target.path)) present.push(target.file)
  }
  if (present.length === 0) return ok(undefined)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const commit = await commitPaths(session.root, {
    parent: plan.ref,
    files: present,
    message: `LearnPath — état avant reprise de l'étape ${plan.step.id}`,
  })
  if (!commit.ok) return commit
  return updateRef(session.root, backupRef(session.parcours.slug, plan.step.id, stamp), commit.value)
}

/** Étapes déjà validées : celles d'avant l'étape courante, ou toutes si le parcours est fini. */
export function validatedCount(session: Session): number {
  const steps = session.parcours.steps
  if (session.state.completedAt !== undefined) return steps.length
  const index = steps.findIndex((s) => s.id === session.state.currentStepId)
  return index < 0 ? 0 : index
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file)
    return true
  } catch {
    return false
  }
}
