import { spawn } from 'node:child_process'
import { type Result, ok, err } from '../core/result.js'

export interface SpawnOptions {
  /** Annulation : une nouvelle sauvegarde doit pouvoir tuer le run en cours. */
  readonly signal?: AbortSignal
  readonly timeoutMs: number
  /** Nom affiché dans les messages : « Vitest », « pytest ». */
  readonly tool: string
  /** pytest écrit ses tracebacks sur stdout, Vitest n'y écrit que du bruit. */
  readonly captureStdout: boolean
  readonly env?: NodeJS.ProcessEnv
}

export interface Outcome {
  readonly code: number | null
  /** Sortie conservée (stderr, plus stdout si demandé), bornée à `OUTPUT_MAX`. */
  readonly output: string
}

/**
 * Borne de la sortie conservée. On coupe **en queue**, pas en tête : la ligne qui nomme la
 * cause est en haut de la stack, c'est la fin qui est jetable.
 */
const OUTPUT_MAX = 32_000

export const DEFAULT_TIMEOUT_MS = 60_000

/**
 * Lance un runner de tests sans shell (D8, D14) : l'argv est construit par l'extension, il
 * n'est jamais donné à un interpréteur de commandes.
 */
export function spawnTool(
  file: string,
  args: readonly string[],
  cwd: string,
  options: SpawnOptions
): Promise<Result<Outcome>> {
  return new Promise((resolve) => {
    const child = spawn(file, [...args], {
      cwd,
      shell: false,
      stdio: ['ignore', options.captureStdout ? 'pipe' : 'ignore', 'pipe'],
      // `timeout` et `signal` sont gérés par node : SIGTERM au processus, puis on ne
      // laisse pas de processus orphelin derrière un run annulé.
      timeout: options.timeoutMs,
      killSignal: 'SIGTERM',
      ...(options.env ? { env: options.env } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    })

    let output = ''
    const keep = (chunk: Buffer): void => {
      if (output.length < OUTPUT_MAX) output = `${output}${chunk.toString()}`.slice(0, OUTPUT_MAX)
    }
    child.stdout?.on('data', keep)
    child.stderr?.on('data', keep)
    child.on('error', (error) =>
      resolve(
        err(
          options.signal?.aborted === true
            ? 'Le lancement des tests a été annulé.'
            : `Impossible de lancer ${options.tool} : ${error.message}`
        )
      )
    )
    child.on('close', (code, signal) => {
      if (options.signal?.aborted === true) {
        resolve(err('Le lancement des tests a été annulé.'))
      } else if (signal !== null) {
        resolve(err(`Les tests ont dépassé le délai imparti et ont été interrompus (${signal}).`))
      } else {
        resolve(ok({ code, output }))
      }
    })
  })
}

/** La sortie entière (bornée à la capture), pas ses cinq dernières lignes : la ligne qui
 * nomme la cause est presque toujours au-dessus de la stack. */
export function detail(outcome: Outcome): string {
  const out = outcome.output.trim()
  return out === '' ? ` Code de sortie ${outcome.code ?? 'inconnu'}.` : `\n${out}`
}
