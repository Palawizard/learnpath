import * as fs from 'node:fs/promises'
import { type Result, ok, err } from './result.js'
import type { ResolvedPath } from './paths.js'
import { writeFileAtomic } from './atomic.js'

/** Version du *format* de `state.json`, indépendante de la version du parcours. */
export const STATE_FORMAT_VERSION = 1

export interface ParcoursState {
  readonly version: number
  readonly slug: string
  /** L'ID de l'étape, jamais son index : insérer une étape ne doit pas décaler la progression. */
  readonly currentStepId: string
  /** id d'étape → nombre d'indices révélés. Donnée la plus intéressante du state (UX.md). */
  readonly hintsRevealed: Readonly<Record<string, number>>
  readonly solutionsRevealed: readonly string[]
  readonly startedAt: string
  readonly updatedAt: string
  /** Présent une fois la dernière étape franchie. Absent tant que le parcours est en cours. */
  readonly completedAt?: string
}

/**
 * Message unique pour tous les états illisibles. Un `state.json` cassé ne doit jamais
 * faire planter l'extension : on propose la réinitialisation, qui est sans risque
 * puisque le state ne contient que de la progression, jamais du code de l'utilisateur.
 */
function unreadable(detail: string): string {
  return `Le fichier .learn/state.json est illisible (${detail}). Lance « LearnPath: Réinitialiser le parcours » pour repartir de la première étape ; ton code n'est pas touché.`
}

export function createState(slug: string, firstStepId: string, now = new Date()): ParcoursState {
  const stamp = now.toISOString()
  return {
    version: STATE_FORMAT_VERSION,
    slug,
    currentStepId: firstStepId,
    hintsRevealed: {},
    solutionsRevealed: [],
    startedAt: stamp,
    updatedAt: stamp,
  }
}

export function parseState(raw: string): Result<ParcoursState> {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return err(unreadable("ce n'est pas du JSON valide"))
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return err(unreadable('le contenu attendu est un objet JSON'))
  }

  const candidate = data as Record<string, unknown>
  if (candidate['version'] !== STATE_FORMAT_VERSION) {
    return err(
      unreadable(
        `version de format inconnue « ${JSON.stringify(candidate['version'])} », cette extension lit la version ${STATE_FORMAT_VERSION}`
      )
    )
  }
  if (typeof candidate['slug'] !== 'string' || typeof candidate['currentStepId'] !== 'string') {
    return err(unreadable('les champs slug et currentStepId sont manquants ou mal typés'))
  }

  return ok({
    version: STATE_FORMAT_VERSION,
    slug: candidate['slug'],
    currentStepId: candidate['currentStepId'],
    hintsRevealed: numberRecord(candidate['hintsRevealed']),
    solutionsRevealed: stringArray(candidate['solutionsRevealed']),
    startedAt: typeof candidate['startedAt'] === 'string' ? candidate['startedAt'] : '',
    updatedAt: typeof candidate['updatedAt'] === 'string' ? candidate['updatedAt'] : '',
    ...(typeof candidate['completedAt'] === 'string' ? { completedAt: candidate['completedAt'] } : {}),
  })
}

export async function readState(file: ResolvedPath): Promise<Result<ParcoursState>> {
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch {
    return err("Aucune progression enregistrée : il n'y a pas de parcours importé dans ce projet.")
  }
  return parseState(raw)
}

export async function writeState(file: ResolvedPath, state: ParcoursState): Promise<void> {
  await writeFileAtomic(file, `${JSON.stringify(state, null, 2)}\n`)
}

export function advanceTo(state: ParcoursState, stepId: string, now = new Date()): ParcoursState {
  return { ...state, currentStepId: stepId, updatedAt: now.toISOString() }
}

/** Dernière étape franchie. `currentStepId` reste la dernière étape : elle est acquise,
 *  elle n'a pas de suivante. */
export function complete(state: ParcoursState, now = new Date()): ParcoursState {
  const stamp = now.toISOString()
  return { ...state, completedAt: stamp, updatedAt: stamp }
}

export function revealHint(state: ParcoursState, stepId: string, now = new Date()): ParcoursState {
  const count = state.hintsRevealed[stepId] ?? 0
  return {
    ...state,
    hintsRevealed: { ...state.hintsRevealed, [stepId]: count + 1 },
    updatedAt: now.toISOString(),
  }
}

export function revealSolution(state: ParcoursState, stepId: string, now = new Date()): ParcoursState {
  if (state.solutionsRevealed.includes(stepId)) return state
  return {
    ...state,
    solutionsRevealed: [...state.solutionsRevealed, stepId],
    updatedAt: now.toISOString(),
  }
}

// Le state est relu depuis le disque : on ne fait confiance à aucun champ.

function numberRecord(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  for (const [key, count] of Object.entries(value)) {
    if (typeof count === 'number' && Number.isFinite(count) && count >= 0) out[key] = count
  }
  return out
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}
