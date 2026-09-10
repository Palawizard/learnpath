import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { type Result, ok, err } from './result.js'
import { type ResolvedPath, safeResolve } from './paths.js'
import { writeFileAtomic } from './atomic.js'
import { launcher, notFoundMessage } from './exec.js'
import type { Parcours } from './parcours.js'
import { createState, writeState } from './state.js'
import { type RunAll, type RunSteps, verifyAllRed, verifyAllGreen } from './verify.js'
import { checkpointStart, writeBaseRef } from './redo.js'

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
  /** `learnpath.gitCheckpoints`. À `false`, aucun point de restauration n'est posé (D36). */
  readonly gitCheckpoints?: boolean
}

export interface ImportReport {
  readonly slug: string
  /** Chemins relatifs au workspace, pour l'affichage. */
  readonly writtenFiles: readonly string[]
  readonly setupCommands: readonly string[]
  readonly gitignoreUpdated: boolean
  /** Pourquoi la reprise d'étape est indisponible pour ce projet (D36). Absent : elle l'est. */
  readonly checkpointsReason?: string
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

  // D36 : l'état de départ se mesure **avant** la moindre écriture — le `.gitignore` est
  // un fichier suivi, et le setup va toucher le lock du gestionnaire de paquets. La
  // référence, elle, n'est posée qu'une fois l'import réussi.
  const checkpoint = await checkpointStart(paths.value.root, parcours, hooks.gitCheckpoints ?? true)

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

  /**
   * D28 : le fichier de parcours est la **seule** chose non reproductible de tout le
   * système — un LLM ne régénère jamais deux fois la même sortie, et le générateur écrit
   * justement dans `.learn/parcours/<slug>.json`, que le rollback effaçait. On le met de
   * côté avant de nettoyer et on le repose ensuite. Retourne son chemin relatif quand il
   * a été conservé, `null` quand il n'y avait rien à conserver.
   */
  const rollbackAll = async (): Promise<string | null> => {
    const parcoursContent = await readOrNull(paths.value.parcoursFile)
    // D33 : même raison pour le journal de diagnostic. Il est écrit par la vérification
    // juste avant qu'elle échoue, il vit sous `.learn/`, et le message d'erreur donne son
    // chemin — le nettoyage l'effaçait, laissant l'utilisateur devant un chemin mort.
    const journalContent = await readOrNull(paths.value.diagnosticLog)
    await rollback()
    if (parcoursContent !== null) await writeFileAtomic(paths.value.parcoursFile, parcoursContent)
    if (journalContent !== null) await writeFileAtomic(paths.value.diagnosticLog, journalContent)

    if (gitignoreUpdated) {
      if (gitignoreBefore === null) await fs.rm(paths.value.gitignore, { force: true })
      else await writeFileAtomic(paths.value.gitignore, gitignoreBefore)
    }
    return parcoursContent === null ? null : relative(workspaceRoot, paths.value.parcoursFile)
  }

  /** Ce qu'on dit à l'utilisateur après un rollback : où est son parcours, ou rien. */
  const kept = (file: string | null): string =>
    file === null
      ? "Rien n'a été conservé."
      : `Le fichier de parcours est conservé, rien d'autre : ${file}.`

  try {
    for (const step of parcours.steps) {
      const file = safeResolve(workspaceRoot, step.tests.file)
      if (!file.ok) return err(`Étape ${step.id}, tests.file : ${file.error}`)
      await writeFileAtomic(file.value, step.tests.content)
      created.push(file.value)
    }

    await writeFileAtomic(
      paths.value.vitestConfig,
      vitestConfig(await findViteConfig(paths.value.root), environmentOf(parcours))
    )
    created.push(paths.value.vitestConfig)

    await writeFileAtomic(paths.value.parcoursFile, `${JSON.stringify(parcours, null, 2)}\n`)
    created.push(paths.value.parcoursFile)

    const firstStep = parcours.steps[0]
    if (firstStep === undefined) return err("Le parcours ne contient aucune étape.")
    await writeState(paths.value.stateFile, createState(parcours.slug, firstStep.id))
    created.push(paths.value.stateFile)

    gitignoreUpdated = await updateGitignore(paths.value.gitignore)
  } catch (error) {
    const saved = await rollbackAll()
    return err(`L'écriture du parcours a échoué : ${message(error)}. ${kept(saved)}`)
  }

  const setup = parcours.runner.setup ?? []
  if (setup.length > 0) {
    if (!(await hooks.confirm(setup))) {
      const saved = await rollbackAll()
      return err(`Import annulé : les commandes d'installation n'ont pas été acceptées. ${kept(saved)}`)
    }
    const exec = hooks.exec ?? runCommand
    for (const command of setup) {
      hooks.log(`$ ${command}`)
      const result = await exec(command, paths.value.cwd, hooks.log)
      if (!result.ok) {
        const saved = await rollbackAll()
        return err(`La commande d'installation « ${command} » a échoué : ${result.error}
${kept(saved)}`)
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
    const saved = await rollbackAll()
    return err(`${red.error} ${kept(saved)}`)
  }

  // D21 : et les solutions, appliquées dans l'ordre, doivent laisser toutes les étapes
  // vertes. Même rollback : un parcours dont les solutions se cassent entre elles ne
  // laisse derrière lui que son propre fichier, dont l'auteur a besoin pour le corriger.
  const green = await verifyAllGreen(parcours, paths.value.root, {
    ...(hooks.runSteps ? { execute: hooks.runSteps } : {}),
    log: say,
  })
  if (!green.ok) {
    const saved = await rollbackAll()
    return err(`${green.error} ${kept(saved)}`)
  }

  let checkpointsReason = checkpoint.reason
  if (checkpoint.head !== undefined) {
    const base = await writeBaseRef(paths.value.root, parcours.slug, checkpoint.head)
    if (!base.ok) checkpointsReason = base.error
  }
  if (checkpointsReason !== undefined) {
    hooks.log(`Reprise d'étape indisponible : ${checkpointsReason}`)
  }

  return ok({
    slug: parcours.slug,
    writtenFiles: created.map((file) => relative(workspaceRoot, file)),
    setupCommands: setup,
    gitignoreUpdated,
    ...(checkpointsReason === undefined ? {} : { checkpointsReason }),
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
  readonly diagnosticLog: ResolvedPath
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
  const diagnosticLog = safeResolve(root, '.learn/verify.log')
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
  if (!diagnosticLog.ok) return err(diagnosticLog.error)
  if (!gitignore.ok) return err(gitignore.error)
  if (!cwd.ok) return err(`Runner, champ cwd : ${cwd.error}`)

  return ok({
    root: workspace.value,
    learnDir: learnDir.value,
    parcoursDir: parcoursDir.value,
    parcoursFile: parcoursFile.value,
    vitestConfig: vitestConfig.value,
    stateFile: stateFile.value,
    diagnosticLog: diagnosticLog.value,
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

/** Noms de config Vite reconnus, dans l'ordre où Vite les cherche lui-même. */
const VITE_CONFIG_NAMES = [
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.cts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cjs',
] as const

/**
 * D31 : la config du projet est **héritée**, pas reconstruite. Un projet React a besoin
 * d'`@vitejs/plugin-react`, un monorepo de ses alias, un projet Vue de son plugin — les
 * deviner un par un serait faux au prochain écosystème. On ne lit que `vite.config.*` :
 * jamais `vitest.config.*`, qui est la config de test du projet et reste hors de portée
 * (D3).
 */
async function findViteConfig(root: ResolvedPath): Promise<string | undefined> {
  for (const name of VITE_CONFIG_NAMES) {
    if (await exists(path.join(root, name))) return name
  }
  return undefined
}

/**
 * Une config Vite ne contient pas d'environnement de test : il n'y a rien à hériter, et
 * `node` casse tout test de composant (« document is not defined »). Le parcours le
 * déclare dans `runner.environment` ; sans ça, on lit ce que son `setup` installe, ce qui
 * rattrape les parcours écrits avant D31.
 */
function environmentOf(parcours: Parcours): string {
  if (parcours.runner.environment !== undefined) return parcours.runner.environment
  // « npm i -D vitest jsdom » : on cherche le paquet, pas la sous-chaîne — une version
  // suffixée (« jsdom@24 ») compte, un « xjsdom » non.
  const setup = (parcours.runner.setup ?? []).join(' ')
  if (/(^|\s)happy-dom(@|\s|$)/.test(setup)) return 'happy-dom'
  if (/(^|\s)jsdom(@|\s|$)/.test(setup)) return 'jsdom'
  return 'node'
}

/**
 * `.mts` et non `.ts` : le paquet de l'utilisateur n'est pas forcément `type: module`, et
 * Vite avertit alors sur une config `.ts` qui utilise `import`.
 * `root` pointe sur le workspace, donc les tests de `.learn/tests/` atteignent `src/` du
 * projet par un chemin relatif normal.
 *
 * Quand le projet a une config Vite, on part de la sienne (plugins, alias, `resolve`) et
 * on lui ajoute notre bloc `test`. Son propre bloc `test` est retiré : c'est la config de
 * test du projet, on ne l'applique pas — sinon ses `include` s'ajouteraient aux nôtres et
 * la vérification à l'import lancerait ses tests à lui (D3, D31).
 */
/** Le bloc fusionné vit dans une fonction : on le décale pour que le fichier reste lisible. */
function indent(block: string): string {
  return block.split('\n').join('\n  ')
}

function vitestConfig(viteConfig: string | undefined, environment: string): string {
  const notre = `{
  root: workspaceRoot,
  // Par défaut Vite écrit son cache dans node_modules/. Or la vérification des solutions
  // (D21) lance ces tests dans une copie du projet où node_modules est une **jonction**
  // vers le vrai node_modules : le cache y retournerait, donc dans le projet de
  // l'utilisateur, hors de .learn/. On l'enferme ici (D25).
  cacheDir: fileURLToPath(new URL('.vite', import.meta.url)),
  test: {
    include: ['.learn/tests/**/*.{spec,test}.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
    environment: '${environment}',
  },
}`

  const entete = `// Généré par LearnPath. Ne pas éditer : réécrit à chaque import.
// Aucun fichier du projet n'est modifié : sa config de test n'est ni lue ni appliquée.
import { fileURLToPath } from 'node:url'
`

  if (viteConfig === undefined) {
    return `${entete}import { defineConfig } from 'vitest/config'

const workspaceRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig(${notre})
`
  }

  return `${entete}import { defineConfig, mergeConfig } from 'vitest/config'
// La config Vite du projet : ses plugins et ses alias valent aussi pour les tests.
import projet from '../${viteConfig}'

const workspaceRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig(async (env) => {
  const resolu = typeof projet === 'function' ? await projet(env) : await projet
  // Son bloc \`test\` est écarté : la config de test du projet ne s'applique pas ici.
  const { test: _test, ...base } = resolu
  return mergeConfig(base, ${indent(notre)})
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
  // Sans ça, l'utilisateur reçoit « spawn npm ENOENT » et personne ne sait ce qui a été
  // cherché (D29). On explique avant même de tenter le lancement.
  if (!launch.resolved) return Promise.resolve(err(notFoundMessage(command, launch)))

  return new Promise((resolve) => {
    const child = spawn(launch.file, [...launch.args], { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (chunk: Buffer) => log(chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => log(chunk.toString()))
    child.on('error', (error) =>
      resolve(
        err(
          isNotFound(error) ? notFoundMessage(command, launch) : message(error)
        )
      )
    )
    child.on('close', (code) =>
      resolve(code === 0 ? ok(undefined) : err(`code de sortie ${code ?? 'inconnu'}`))
    )
  })
}

/** Chemin d'affichage, toujours en barres obliques : il finit dans des messages. */
function relative(root: string, file: string): string {
  return path.relative(path.resolve(root), file).replace(/\\/g, '/')
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

/** `ENOENT`/`EINVAL` sur un lancement : le binaire résolu n'était pas lançable après tout. */
function isNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown }).code
  return code === 'ENOENT' || code === 'EINVAL'
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
