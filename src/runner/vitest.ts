import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { type Result, ok, err } from '../core/result.js'
import { vitestCli } from '../core/exec.js'
import type { ResolvedPath } from '../core/paths.js'
import { escapeRegex } from './classify.js'
import { type RawResult, parseResult } from './parse.js'

export interface RunOptions {
  /** Annulation : une nouvelle sauvegarde doit pouvoir tuer le run en cours. */
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  /** `runner.cwd` déjà résolu. Par défaut, la racine du workspace. */
  readonly cwd?: ResolvedPath
}

const DEFAULT_TIMEOUT_MS = 60_000
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

    const spawned = await spawnVitest(args, cwd, options)
    if (!spawned.ok) return spawned

    let content: string
    try {
      content = await fs.readFile(outputFile, 'utf8')
    } catch {
      return err(`Vitest n'a produit aucun rapport.${detail(spawned.value)}`)
    }
    const parsed = parseResult(content)
    if (!parsed.ok) return err(`${parsed.error}.${detail(spawned.value)}`)
    return parsed
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

interface Outcome {
  readonly code: number | null
  readonly stderr: string
}

function spawnVitest(
  args: readonly string[],
  cwd: string,
  options: RunOptions
): Promise<Result<Outcome>> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...args], {
      cwd,
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
      // `timeout` et `signal` sont gérés par node : SIGTERM au processus, puis on ne
      // laisse pas de processus orphelin derrière un run annulé.
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      killSignal: 'SIGTERM',
      ...(options.signal ? { signal: options.signal } : {}),
    })

    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4000)
    })
    child.on('error', (error) =>
      resolve(
        err(
          options.signal?.aborted === true
            ? 'Le lancement des tests a été annulé.'
            : `Impossible de lancer Vitest : ${error.message}`
        )
      )
    )
    child.on('close', (code, signal) => {
      if (options.signal?.aborted === true) {
        resolve(err('Le lancement des tests a été annulé.'))
      } else if (signal !== null) {
        resolve(err(`Les tests ont dépassé le délai imparti et ont été interrompus (${signal}).`))
      } else {
        resolve(ok({ code, stderr }))
      }
    })
  })
}

function detail(outcome: Outcome): string {
  const tail = outcome.stderr.trim().split('\n').slice(-5).join('\n')
  return tail === '' ? ` Code de sortie ${outcome.code ?? 'inconnu'}.` : `\n${tail}`
}
