import * as fs from 'node:fs/promises'
import type { Parcours } from './parcours.js'
import { type Result, ok, err } from './result.js'
import { safeResolve } from './paths.js'
import { isSignificant, significantAdditions } from './diff.js'

/**
 * Règles d'import qui portent sur la **pédagogie** du parcours plutôt que sur sa forme
 * (D40 à D42). Elles ne vivent pas dans `loadParcours` : celui-ci relit aussi un parcours
 * déjà importé à chaque session, et un parcours importé avant ces règles doit rester
 * jouable. C'est l'import qui fait barrage, pas la lecture.
 */

/**
 * Au-delà, l'étape demande trop à la fois. La spec dit « environ 15 lignes » ; la marge
 * absorbe les imports et les signatures, qui comptent sans être le cœur de l'étape.
 */
export const MAX_STEP_LINES = 20

/** Contenu des fichiers du projet avant le parcours, par chemin relatif (D45). */
export type Baseline = Readonly<Record<string, string>>

/**
 * Contenu d'un fichier juste avant l'étape `index` : la dernière solution antérieure qui
 * l'écrit, sinon le fichier tel qu'il était dans le projet (D45), sinon vide.
 */
export function contentBefore(parcours: Parcours, index: number, file: string, baseline: Baseline = {}): string {
  for (let i = index - 1; i >= 0; i--) {
    const content = parcours.steps[i]?.solution[file]
    if (content !== undefined) return content
  }
  return baseline[file] ?? ''
}

/** Où la base est figée à l'import, pour que le panneau et un réimport la retrouvent. */
export function baselinePath(slug: string): string {
  return `.learn/baseline/${slug}.json`
}

/**
 * La base d'un parcours : celle figée à son import s'il y en a une, complétée par le disque
 * pour les fichiers qu'elle ne connaît pas. Un réimport du même slug en cours de parcours
 * mesure donc toujours depuis le projet d'origine, pas depuis le travail déjà fait.
 * Un chemin refusé par `safeResolve` est ignoré : `loadParcours` l'a déjà signalé.
 */
export async function readBaseline(parcours: Parcours, workspaceRoot: string): Promise<Baseline> {
  const frozen = await readFrozenBaseline(parcours.slug, workspaceRoot)
  const files = new Set(parcours.steps.flatMap((step) => Object.keys(step.solution)))
  const baseline: Record<string, string> = {}
  for (const file of files) {
    const known = frozen[file]
    if (known !== undefined) {
      baseline[file] = known
      continue
    }
    const resolved = safeResolve(workspaceRoot, file)
    if (!resolved.ok) continue
    try {
      baseline[file] = await fs.readFile(resolved.value, 'utf8')
    } catch {
      // Absent : le parcours le crée.
    }
  }
  return baseline
}

/**
 * La base figée à l'import, ou vide : absente pour un parcours importé avant D45, et un
 * fichier illisible ou mal formé ne doit pas empêcher de jouer — le panneau montre alors
 * les solutions entières, comme avant.
 */
export async function readFrozenBaseline(slug: string, workspaceRoot: string): Promise<Baseline> {
  const file = safeResolve(workspaceRoot, baselinePath(slug))
  if (!file.ok) return {}
  try {
    const raw: unknown = JSON.parse(await fs.readFile(file.value, 'utf8'))
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
    return Object.fromEntries(
      Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    )
  } catch {
    return {}
  }
}

/** Lignes significatives que l'étape `index` demande d'écrire, tous fichiers confondus. */
export function stepSize(parcours: Parcours, index: number, baseline: Baseline = {}): number {
  const step = parcours.steps[index]
  if (step === undefined) return 0
  return Object.entries(step.solution).reduce(
    (total, [file, content]) => total + significantAdditions(contentBefore(parcours, index, file, baseline), content),
    0
  )
}

export function checkPedagogy(parcours: Parcours, baseline: Baseline = {}): Result<void> {
  const problems: string[] = []

  if (parcours.scope === undefined) {
    problems.push(
      'le champ « scope » est absent : le parcours doit dire ce qu’il couvre de la demande (scope.covered) et ce qu’il laisse de côté (scope.notCovered, vide si rien)'
    )
  }

  parcours.steps.forEach((step, index) => {
    const at = `Étape ${step.id}`

    if ((step.examples ?? []).length === 0) {
      problems.push(
        `${at} : aucun exemple (examples). Chaque étape montre la syntaxe dont elle a besoin sur un autre sujet que l’étape`
      )
    }

    const size = stepSize(parcours, index, baseline)
    if (size > MAX_STEP_LINES) {
      problems.push(
        `${at} : la solution demande ${size} lignes à écrire, le maximum est ${MAX_STEP_LINES}. Coupe l’étape en deux`
      )
    }

    const added = addedLines(parcours, index, baseline)
    for (const example of step.examples ?? []) {
      if (copiesSolution(example.code, added)) {
        problems.push(
          `${at} : l’exemple « ${example.title} » reprend la solution de l’étape. Un exemple montre la syntaxe sur un autre sujet, il ne donne pas la réponse`
        )
      }
    }
  })

  if (problems.length === 0) return ok(undefined)
  return err(
    [
      `Parcours refusé : ${problems.length} problème(s) de conception pédagogique.`,
      ...problems.map((problem) => `• ${problem}.`),
    ].join('\n')
  )
}

/** Lignes (normalisées) ajoutées par la solution de l'étape. */
function addedLines(parcours: Parcours, index: number, baseline: Baseline): ReadonlySet<string> {
  const step = parcours.steps[index]
  const lines = new Set<string>()
  if (step === undefined) return lines
  for (const [file, content] of Object.entries(step.solution)) {
    const before = new Set(contentBefore(parcours, index, file, baseline).split('\n').map(normalize))
    for (const line of content.split('\n')) {
      const normalized = normalize(line)
      if (!before.has(normalized)) lines.add(normalized)
    }
  }
  return lines
}

/**
 * Un exemple recopie la solution quand plus de la moitié de ses lignes « parlantes » se
 * retrouvent telles quelles dans ce que l'étape ajoute.
 *
 * ponytail: heuristique par égalité de lignes normalisées. Un exemple qui renomme juste les
 * variables passe entre les mailles ; passer à une similarité par jetons si ça arrive.
 */
function copiesSolution(code: string, added: ReadonlySet<string>): boolean {
  const telling = code
    .split('\n')
    .filter((line) => isSignificant(line) && !/^\s*(import|from)\s/.test(line))
    .map(normalize)
    .filter((line) => line.length >= 12)
  if (telling.length < 3) return false
  const copied = telling.filter((line) => added.has(line)).length
  return copied / telling.length > 0.5
}

function normalize(line: string): string {
  return line.trim().replace(/\s+/g, ' ')
}
