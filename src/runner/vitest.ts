import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { type Result, ok, err } from '../core/result.js'
import { vitestCli } from '../core/exec.js'
import type { ResolvedPath } from '../core/paths.js'
import { escapeRegex } from './classify.js'
import { type RawResult, parseResult } from './parse.js'
import { DEFAULT_TIMEOUT_MS, detail, spawnTool } from './spawn.js'

export interface RunOptions {
  /** Annulation : une nouvelle sauvegarde doit pouvoir tuer le run en cours. */
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  /** `runner.cwd` déjà résolu. Par défaut, la racine du workspace. */
  readonly cwd?: ResolvedPath
}

const CONFIG = '.learn/vitest.config.mts'

/**
 * La commande n'est plus lue dans le parcours (D14) : on la construit ici à partir de
 * `runner.kind`. `shell: false` et argv découpé, comme pour le setup. Le CLI de Vitest
 * est lancé par le Node courant, sans passer par `npx` (D18).
 */
export async function run(
  root: ResolvedPath,
  stepIds: readonly string[],
  options: RunOptions = {}
): Promise<Result<RawResult>> {
  const cwd = options.cwd ?? root
  // Un chemin de sortie propre à chaque run : deux runs concurrents ne doivent pas lire
  // le rapport l'un de l'autre, et rien n'est laissé dans le projet de l'utilisateur.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'learnpath-'))
  const outputFile = path.join(dir, 'result.json')

  try {
    const cli = vitestCli(root)
    if (!cli.ok) return cli
    const args = [
      cli.value,
      'run',
      '--config',
      path.relative(cwd, path.join(root, CONFIG)),
      '--reporter=json',
      `--outputFile=${outputFile}`,
      ...filterArgs(stepIds),
    ]

    const spawned = await spawnTool(process.execPath, args, cwd, {
      tool: 'Vitest',
      captureStdout: false,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...(options.signal ? { signal: options.signal } : {}),
    })
    if (!spawned.ok) return spawned

    let content: string
    try {
      content = await fs.readFile(outputFile, 'utf8')
    } catch {
      return err(`Vitest n'a produit aucun rapport.${detail(spawned.value)}`)
    }
    const parsed = parseResult(content)
    if (!parsed.ok) return err(`${parsed.error}.${detail(spawned.value)}`)
    // La stderr est conservée entière, même quand le rapport est lisible : une collecte
    // qui casse sur la config ou sur un plugin n'écrit rien dans le rapport, sa stack
    // n'existe qu'ici. La tronquer, c'est perdre le seul diagnostic disponible.
    return ok({ ...parsed.value, stderr: spawned.value.output })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

/**
 * Vitest interprète `-t` comme une expression régulière : « step 1.1 » sans échappement
 * matcherait « step 111 ». Une alternance échappée cible l'étape courante et ses
 * précédentes pour la régression.
 */
export function filterArgs(stepIds: readonly string[]): readonly string[] {
  if (stepIds.length === 0) return []
  return ['-t', stepIds.map((id) => `step ${escapeRegex(id)}`).join('|')]
}
