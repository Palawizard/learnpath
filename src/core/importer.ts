import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { type Result, ok, err } from './result.js'
import { type ResolvedPath, safeResolve } from './paths.js'
import { writeFileAtomic } from './atomic.js'
import { launcher } from './exec.js'
import type { Parcours } from './parcours.js'
import { createState, writeState } from './state.js'
import { type RunAll, type RunSteps, verifyAllRed, verifyAllGreen } from './verify.js'

export interface ImportHooks {
  /**
   * Affiche les commandes **exactes** de `runner.setup` et attend une décision. L'importer
   * ne connaît pas `vscode` : c'est `extension.ts` qui branche la vraie boîte de dialogue.
   */
  readonly confirm: (commands: readonly string[]) => Promise<boolean>
  readonly log: (line: string) => void
  /** Point d'injection des tests. Par défaut : `spawn` sans shell. */
  readonly exec?: (command: string, cwd: ResolvedPath, log: (line: string) => void) => Promise<Result<void>>
  /** Point d'injection des tests pour la vérification « tout doit être rouge » (D5). */
  readonly runAll?: RunAll
  /** Point d'injection des tests pour la vérification des solutions (D21). */
  readonly runSteps?: RunSteps
  /**
   * Étape en cours, pour une barre de progression. L'import lance N+1 runs de tests : sans
   * ça, l'utilisateur regarde une fenêtre figée pendant une dizaine de secondes.
   */
  readonly progress?: (message: string) => void
}

export interface ImportReport {
  readonly slug: string
  /** Chemins relatifs au workspace, pour l'affichage. */
  readonly writtenFiles: readonly string[]
  readonly setupCommands: readonly string[]
  readonly gitignoreUpdated: boolean
}

/** Seule entrée ajoutée au `.gitignore` : la progression. Le rapport de test, lui, est
 *  écrit dans un temporaire système et ne touche jamais le projet (D14). */
const GITIGNORE_ENTRIES = ['.learn/state.json', '.learn/.vite/'] as const
const GITIGNORE_MARKER = '# LearnPath'

export async function importParcours(
  parcours: Parcours,
  workspaceRoot: string,
  hooks: ImportHooks
): Promise<Result<ImportReport>> {
  const paths = resolveTargets(parcours, workspaceRoot)
  if (!paths.ok) return paths

  const learnExisted = await exists(paths.value.learnDir)
  const conflict = await findSlugConflict(paths.value.parcoursDir, parcours.slug)
  if (!conflict.ok) return conflict

  // Tout ce qu'on a créé, pour pouvoir revenir en arrière si l'utilisateur refuse le
  // setup ou si une écriture échoue à mi-chemin.
  const created: string[] = []
  const rollback = async (): Promise<void> => {
    if (learnExisted) {
      for (const file of created) await fs.rm(file, { force: true })
    } else {
      await fs.rm(paths.value.learnDir, { recursive: true, force: true })
    }
  }

  // Le `.gitignore` est un fichier de l'utilisateur : un rollback doit le rendre tel
  // qu'il était, pas seulement supprimer `.learn/`.
  const gitignoreBefore = await readOrNull(paths.value.gitignore)
  let gitignoreUpdated = false
  const rollbackAll = async (): Promise<void> => {
    await rollback()
    if (!gitignoreUpdated) return
    if (gitignoreBefore === null) await fs.rm(paths.value.gitignore, { force: true })
    else await writeFileAtomic(paths.value.gitignore, gitignoreBefore)
  }

  try {
    for (const step of parcours.steps) {
      const file = safeResolve(workspaceRoot, step.tests.file)
      if (!file.ok) return err(`Étape ${step.id}, tests.file : ${file.error}`)
      await writeFileAtomic(file.value, step.tests.content)
      created.push(file.value)
    }

    await writeFileAtomic(paths.value.vitestConfig, vitestConfig())
    created.push(paths.value.vitestConfig)

    await writeFileAtomic(paths.value.parcoursFile, `${JSON.stringify(parcours, null, 2)}\n`)
    created.push(paths.value.parcoursFile)

    const firstStep = parcours.steps[0]
    if (firstStep === undefined) return err("Le parcours ne contient aucune étape.")
    await writeState(paths.value.stateFile, createState(parcours.slug, firstStep.id))
    created.push(paths.value.stateFile)

    gitignoreUpdated = await updateGitignore(paths.value.gitignore)
  } catch (error) {
    await rollbackAll()
    return err(`L'écriture du parcours a échoué, rien n'a été conservé : ${message(error)}`)
  }

  const setup = parcours.runner.setup ?? []
  if (setup.length > 0) {
    if (!(await hooks.confirm(setup))) {
      await rollbackAll()
      return err("Import annulé : les commandes d'installation n'ont pas été acceptées.")
    }
    const exec = hooks.exec ?? runCommand
    for (const command of setup) {
      hooks.log(`$ ${command}`)
      const result = await exec(command, paths.value.cwd, hooks.log)
      if (!result.ok) {
        await rollbackAll()
        return err(`La commande d'installation « ${command} » a échoué : ${result.error}`)
      }
    }
  }

  const progress = hooks.progress
  const say = (line: string): void => {
    hooks.log(line)
    progress?.(line)
  }

  say('Vérification : toutes les étapes doivent être rouges avant écriture.')
  const red = await verifyAllRed(parcours, paths.value.root, hooks.runAll)
  if (!red.ok) {
    await rollbackAll()
    return err(`${red.error} Rien n'a été conservé.`)
  }

  // D21 : et les solutions, appliquées dans l'ordre, doivent laisser toutes les étapes
  // vertes. Même rollback : un parcours dont les solutions se cassent entre elles ne
  // laisse rien derrière lui.
  const green = await verifyAllGreen(parcours, paths.value.root, {
    ...(hooks.runSteps ? { execute: hooks.runSteps } : {}),
    log: say,
  })
  if (!green.ok) {
    await rollbackAll()
    return err(`${green.error} Rien n'a été conservé.`)
  }

  return ok({
    slug: parcours.slug,
    writtenFiles: created.map((file) => path.relative(path.resolve(workspaceRoot), file)),
    setupCommands: setup,
    gitignoreUpdated,
  })
}

// --- Chemins ---------------------------------------------------------------------------

interface Targets {
  readonly root: ResolvedPath
  readonly learnDir: ResolvedPath
  readonly parcoursDir: ResolvedPath
  readonly parcoursFile: ResolvedPath
  readonly vitestConfig: ResolvedPath
  readonly stateFile: ResolvedPath
  readonly gitignore: ResolvedPath
  readonly cwd: ResolvedPath
}

function resolveTargets(parcours: Parcours, root: string): Result<Targets> {
  const workspace = safeResolve(root, '.', { allowRoot: true })
  const learnDir = safeResolve(root, '.learn')
  const parcoursDir = safeResolve(root, '.learn/parcours')
  const parcoursFile = safeResolve(root, `.learn/parcours/${parcours.slug}.json`)
  const vitestConfig = safeResolve(root, '.learn/vitest.config.mts')
  const stateFile = safeResolve(root, '.learn/state.json')
  const gitignore = safeResolve(root, '.gitignore')
  // `runner.cwd` vaut « . » dans la quasi-totalité des parcours : c'est le seul endroit
  // où la racine du workspace est un chemin acceptable.
  const cwd = safeResolve(root, parcours.runner.cwd ?? '.', { allowRoot: true })

  if (!workspace.ok) return err(workspace.error)
  if (!learnDir.ok) return err(learnDir.error)
  if (!parcoursDir.ok) return err(parcoursDir.error)
  if (!parcoursFile.ok) return err(`Le slug « ${parcours.slug} » ne donne pas un nom de fichier valide : ${parcoursFile.error}`)
  if (!vitestConfig.ok) return err(vitestConfig.error)
  if (!stateFile.ok) return err(stateFile.error)
  if (!gitignore.ok) return err(gitignore.error)
  if (!cwd.ok) return err(`Runner, champ cwd : ${cwd.error}`)

  return ok({
    root: workspace.value,
    learnDir: learnDir.value,
    parcoursDir: parcoursDir.value,
    parcoursFile: parcoursFile.value,
    vitestConfig: vitestConfig.value,
    stateFile: stateFile.value,
    gitignore: gitignore.value,
    cwd: cwd.value,
  })
}

// --- Étapes ----------------------------------------------------------------------------

/**
 * On n'écrase jamais le parcours d'un autre slug : la progression et les tests de
 * l'utilisateur disparaîtraient sans qu'il l'ait demandé. C'est à l'appelant de proposer
 * une réinitialisation.
 */
async function findSlugConflict(parcoursDir: ResolvedPath, slug: string): Promise<Result<void>> {
  let entries: string[]
  try {
    entries = await fs.readdir(parcoursDir)
  } catch {
    return ok(undefined)
  }
  const other = entries.filter((name) => name.endsWith('.json') && name !== `${slug}.json`)
  if (other.length === 0) return ok(undefined)
  const names = other.map((name) => name.replace(/\.json$/, '')).join(', ')
  return err(
    `Le dossier .learn/ contient déjà le parcours « ${names} ». Réinitialise-le avant d'importer « ${slug} » : rien n'a été écrasé.`
  )
}

/**
 * `.mts` et non `.ts` : le paquet de l'utilisateur n'est pas forcément `type: module`, et
 * Vite avertit alors sur une config `.ts` qui utilise `import`.
 * `root` pointe sur le workspace, donc les tests de `.learn/tests/` atteignent `src/` du
 * projet par un chemin relatif normal, et la config de test du projet n'est jamais lue.
 */
function vitestConfig(): string {
  return `// Généré par LearnPath. Ne pas éditer : réécrit à chaque import.
// La configuration de test du projet n'est ni lue ni modifiée.
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const workspaceRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  root: workspaceRoot,
  // Par défaut Vite écrit son cache dans node_modules/. Or la vérification des solutions
  // (D21) lance ces tests dans une copie du projet où node_modules est une **jonction**
  // vers le vrai node_modules : le cache y retournerait, donc dans le projet de
  // l'utilisateur, hors de .learn/. On l'enferme ici (D25).
  cacheDir: fileURLToPath(new URL('.vite', import.meta.url)),
  test: {
    include: ['.learn/tests/**/*.{spec,test}.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
    environment: 'node',
  },
})
`
}

/** Idempotent : relancer l'import ne duplique aucune ligne. */
async function updateGitignore(file: ResolvedPath): Promise<boolean> {
  let content = ''
  try {
    content = await fs.readFile(file, 'utf8')
  } catch {
    content = ''
  }
  const present = new Set(content.split('\n').map((line) => line.trim()))
  const missing = GITIGNORE_ENTRIES.filter((entry) => !present.has(entry))
  if (missing.length === 0) return false

  const prefix = content === '' || content.endsWith('\n') ? content : `${content}\n`
  const header = present.has(GITIGNORE_MARKER) ? '' : `${GITIGNORE_MARKER}\n`
  await writeFileAtomic(file, `${prefix}${header}${missing.join('\n')}\n`)
  return true
}

// --- Exécution du setup ------------------------------------------------------------------

/**
 * `shell: false` et argv découpé : la commande vient d'un JSON généré par un LLM, elle
 * n'est jamais donnée à un shell. `validateCommand` (lot 1) a déjà refusé les
 * métacaractères, ceci est la deuxième barrière.
 */
function runCommand(
  command: string,
  cwd: ResolvedPath,
  log: (line: string) => void
): Promise<Result<void>> {
  const [binary, ...args] = command.trim().split(/\s+/)
  if (binary === undefined) return Promise.resolve(err('la commande est vide'))
  const launch = launcher(binary, args)

  return new Promise((resolve) => {
    const child = spawn(launch.file, [...launch.args], { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (chunk: Buffer) => log(chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => log(chunk.toString()))
    child.on('error', (error) => resolve(err(message(error))))
    child.on('close', (code) =>
      resolve(code === 0 ? ok(undefined) : err(`code de sortie ${code ?? 'inconnu'}`))
    )
  })
}

async function readOrNull(file: ResolvedPath): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target)
    return true
  } catch {
    return false
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
