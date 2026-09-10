import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { type Result, ok, err } from './result.js'
import { type ResolvedPath, safeResolve } from './paths.js'
import { writeFileAtomic } from './atomic.js'
import { planSolution } from './reveal.js'
import { humanize, phaseOf } from './humanize.js'
import type { Parcours } from './parcours.js'
import type { RawResult } from '../runner/parse.js'
import { type Classification, type State, classify } from '../runner/classify.js'
import { run } from '../runner/vitest.js'

/** Point d'injection des tests : par défaut, un vrai run Vitest sans filtre. */
export type RunAll = (root: ResolvedPath) => Promise<Result<RawResult>>

const runAll: RunAll = (root) => run(root, [])

/**
 * D5 : à l'import, on lance tous les tests sur le projet en l'état et on exige que
 * chaque étape soit rouge. Une étape déjà verte avant que l'étudiant ait écrit quoi que
 * ce soit est un test vide ou tautologique — le parcours ne vaut rien, on le refuse en
 * nommant l'étape.
 *
 * D33 : « rouge » veut dire que les tests de l'étape ont été **collectés** et qu'ils
 * échouent — soit une assertion en échec, soit le fichier que l'étape demande d'écrire qui
 * n'existe pas encore (`missing-file`), qui est l'état normal avant l'exercice. Zéro test
 * collecté n'est pas rouge : c'est un parcours dont on ne sait rien. Le compter comme rouge
 * faisait passer la garantie sur un parcours dont aucun test ne s'exécute, exactement le
 * parcours bidon que ce module doit attraper.
 */
export async function verifyAllRed(
  parcours: Parcours,
  root: ResolvedPath,
  execute: RunAll = runAll
): Promise<Result<void>> {
  const result = await execute(root)
  if (!result.ok) {
    return err(`La vérification du parcours n'a pas pu être faite : ${result.error}`)
  }

  const seen = parcours.steps.map((step) => ({ step, result: classify(result.value, step) }))

  const green = seen.filter((s) => s.result.state === 'pass').map((s) => s.step)
  if (green.length > 0) {
    const names = green.map(name).join(', ')
    return err(
      `Ce parcours est invalide : ${green.length > 1 ? 'les étapes' : "l'étape"} ${names} ${green.length > 1 ? 'passent' : 'passe'} déjà alors que rien n'a été écrit. Un test qui est vert avant l'exercice ne teste rien.`
    )
  }

  const mute = seen.filter((s) => !RED.has(s.result.state))
  const first = mute[0]
  if (first === undefined) return ok(undefined)

  const others = mute.length > 1 ? ` (et ${mute.slice(1).map((s) => s.step.id).join(', ')})` : ''
  // Preuve que l'outillage marche : une autre étape du **même run** a reçu un verdict.
  const toolingWorks = seen.some((s) => s.result.state !== 'collect-error')
  const journal = await keepDiagnostic(root, result.value, mute)
  return err(
    `Ce parcours est invalide : aucun test de l'étape ${name(first.step)}${others} n'a été collecté${detail(first.result)}. Rien ne s'est exécuté, donc rien ne prouve que l'étape échoue avant l'exercice — ${cause(toolingWorks)}${journal}`
  )
}

/**
 * Les deux seuls états qui prouvent un échec : une assertion collectée qui échoue, et le
 * fichier attendu de l'étape qui n'existe pas encore. Tout le reste veut dire « on n'a rien
 * vu tourner ».
 */
const RED: ReadonlySet<State> = new Set<State>(['assertion-failed', 'missing-file'])

/**
 * D33 : la seule séparation qu'on sache faire sans mentir — et elle ne vient **pas** du
 * texte de l'erreur. Un fichier de test mal formé et un fichier importé mal formé
 * produisent le même message, sans chemin (fixtures `b-syntaxe-invalide` et
 * `test-mal-forme`) : le lire pour désigner un coupable, c'est deviner.
 *
 * Ce qu'on sait vraiment, c'est si une **autre** étape du même run a reçu un verdict. Si
 * oui, l'outillage marche et la cause est locale à ce fichier. Si non, elle est partagée et
 * on ne désigne personne.
 */
function cause(toolingWorks: boolean): string {
  return toolingWorks
    ? "les autres étapes du parcours, elles, ont bien été évaluées : la cause est dans ce fichier de test ou dans ce qu'il importe."
    : "aucune étape du parcours n'a été évaluée, cause indéterminée : la config Vite, un plugin, le runner, ou un import commun à tous les fichiers de test."
}

// --- Vérification des solutions (D21) ------------------------------------------------------

/** Point d'injection des tests : par défaut, un vrai run Vitest filtré sur des étapes. */
export type RunSteps = (root: ResolvedPath, stepIds: readonly string[]) => Promise<Result<RawResult>>

export interface GreenHooks {
  readonly execute?: RunSteps
  /** Progression : la vérification coûte un run par étape, elle ne doit pas être muette. */
  readonly log?: (line: string) => void
}

/**
 * D21 : `verifyAllRed` ne voit pas la solution qui écrase le travail des étapes
 * précédentes — le mode de défaillance systématique du contenu généré par un LLM. On
 * applique donc les solutions étape par étape dans une **copie temporaire** du workspace,
 * et après l'étape N on exige que les étapes 1..N soient toutes vertes. Ça attrape les
 * deux fautes d'un coup, et on les nomme différemment : une solution qui régresse n'est
 * pas une solution qui ne passe pas ses propres tests.
 */
export async function verifyAllGreen(
  parcours: Parcours,
  root: ResolvedPath,
  hooks: GreenHooks = {}
): Promise<Result<void>> {
  const execute = hooks.execute ?? ((r, ids) => run(r, ids))
  const log = hooks.log ?? (() => undefined)

  const sandbox = await cloneWorkspace(root, log)
  if (!sandbox.ok) return sandbox

  try {
    const steps = parcours.steps
    for (const [index, step] of steps.entries()) {
      log(`Vérification des solutions : étape ${step.id} (${index + 1}/${steps.length})…`)

      const targets = planSolution(sandbox.value, step)
      if (!targets.ok) return err(`Ce parcours est invalide : ${targets.error}`)
      for (const target of targets.value) await writeFileAtomic(target.path, target.content)

      const played = steps.slice(0, index + 1)
      const raw = await execute(sandbox.value, played.map((s) => s.id))
      if (!raw.ok) {
        return err(`La vérification des solutions n'a pas pu être faite : ${raw.error}`)
      }

      const own = classify(raw.value, step)
      if (own.state !== 'pass') {
        // Une étape déjà jouée qui passe dans ce run prouve que l'outillage marche.
        const toolingWorks = played.some((s) => s !== step && classify(raw.value, s).state === 'pass')
        // Le journal va dans le **vrai** projet, pas dans le bac à sable : celui-ci est
        // supprimé en sortant, le diagnostic disparaîtrait avec lui.
        const journal = await keepDiagnostic(root, raw.value, [{ step, result: own }])
        return err(`Ce parcours est invalide : ${wrong(step, own, toolingWorks)}${journal}`)
      }

      const broken = played
        .slice(0, index)
        .map((previous) => ({ step: previous, result: classify(raw.value, previous) }))
        .filter((b) => b.result.state !== 'pass')
      const first = broken[0]
      if (first !== undefined) {
        const others =
          broken.length > 1 ? ` (et ${broken.slice(1).map((b) => b.step.id).join(', ')})` : ''
        const journal = await keepDiagnostic(root, raw.value, broken)
        return err(
          `Ce parcours est invalide : la solution de l'étape ${name(step)} casse l'étape ${name(first.step)}${others}${detail(first.result)}. Une solution doit être le contenu complet du fichier à ce stade, pas un extrait.${journal}`
        )
      }
    }
    return ok(undefined)
  } finally {
    await fs.rm(sandbox.value, { recursive: true, force: true })
  }
}

function name(step: Parcours['steps'][number]): string {
  return `« ${step.id} — ${step.title} »`
}

/**
 * Une solution qui ne passe pas ses propres tests et un fichier de test qui ne se collecte
 * pas ne sont pas le même problème et n'appellent pas la même correction : dans le premier
 * cas la solution est fausse, dans le second le fichier de test est mal formé et **aucun**
 * test n'a tourné. Les confondre envoie l'auteur du parcours corriger le mauvais fichier.
 */
function wrong(
  step: Parcours['steps'][number],
  result: Classification,
  toolingWorks: boolean
): string {
  if (result.state === 'missing-file') {
    // La solution vient d'être écrite : si l'import ne se résout toujours pas, ce n'est plus
    // « pas encore écrit ». Nommer le spécificateur est tout le diagnostic — un alias que la
    // config du projet ne déclare pas ressemble sinon à une faute de clé qui n'existe pas.
    const spec = result.missing === undefined ? '' : ` (« ${result.missing} » reste introuvable)`
    return `la solution de l'étape ${name(step)} n'écrit pas le fichier attendu par ses tests, ou le test ne sait pas le résoudre${spec}. Vérifie les clés de « solution » et « expected.files », et les alias de la config du projet.`
  }
  // D33 : on dit ce qu'on a vu — aucun test collecté — sans nommer de coupable qu'on ne
  // connaît pas. La stack complète part dans le journal, elle le dira mieux que nous.
  if (result.state === 'collect-error') {
    return `le fichier de test de l'étape ${name(step)} ne s'est pas collecté, aucun de ses tests n'a tourné${detail(result)} — ${cause(toolingWorks)} Rien ne dit que la solution est en cause.`
  }
  return `la solution de l'étape ${name(step)} ne passe pas ses propres tests${detail(result)}. Si la solution de l'auteur ne passe pas, l'étudiant n'a aucune chance.`
}

function detail(result: Classification): string {
  const line = result.message?.split('\n')[0]?.trim()
  if (line === undefined || line === '') return ''
  const human = humanize(result.message ?? '', phaseOf(result.state))
  return human === undefined ? ` (${line})` : ` (${human.split('\n')[0] ?? ''} — ${line})`
}

// --- Journal de diagnostic (D33) -----------------------------------------------------------

/**
 * Le message d'erreur ne porte que la première ligne : une stack entière dans une
 * notification est illisible. Mais la jeter, c'est ce qui a fait chercher au mauvais
 * endroit trois fois de suite. Elle part donc **entière** dans un fichier, sous `.learn/`
 * comme tout ce qu'on écrit, et le message donne son chemin.
 *
 * Best effort : si le journal ne peut pas être écrit, le message reste ce qu'il était.
 * Perdre le diagnostic est déjà mauvais, échouer l'import à cause du journal serait pire.
 */
const DIAGNOSTIC_LOG = '.learn/verify.log'

interface Faulty {
  readonly step: Parcours['steps'][number]
  readonly result: Classification
}

async function keepDiagnostic(
  root: ResolvedPath,
  raw: RawResult,
  faulty: readonly Faulty[]
): Promise<string> {
  const sections = faulty.map(
    (f) => `--- étape ${f.step.id} — ${f.step.title} (${f.result.state}) ---\n${f.result.message ?? '(aucun message)'}`
  )
  // La stderr du processus Vitest : une collecte cassée par la config ou par un plugin
  // n'écrit rien dans le rapport JSON, sa stack n'est que là.
  if (raw.stderr.trim() !== '') sections.push(`--- sortie d'erreur de Vitest ---\n${raw.stderr.trim()}`)

  const file = path.join(root, DIAGNOSTIC_LOG)
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, `${new Date().toISOString()}\n\n${sections.join('\n\n')}\n`, 'utf8')
  } catch {
    return ''
  }
  return ` Diagnostic complet (stack entière) : ${DIAGNOSTIC_LOG}`
}

/**
 * Dossiers qu'on ne copie jamais : ils ne servent pas à lancer des tests et ils pèsent
 * l'essentiel d'un vrai dépôt. Filet de sécurité quand le projet n'est pas suivi par git.
 */
const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.astro',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.vite',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.tox',
  'target',
  '.gradle',
  '.idea',
  '.vscode-test',
  '.yarn',
])

/**
 * Au-delà, on prévient explicitement avant de continuer : la copie va être longue et
 * occuper autant de place dans le temporaire système. On n'abandonne pas — c'est peut-être
 * légitime — mais l'utilisateur doit savoir pourquoi ça dure.
 */
const SIZE_WARNING_BYTES = 100 * 1024 * 1024

/**
 * Copie du workspace pour y appliquer les solutions. `node_modules` n'est pas copié mais
 * **relié** : copier des dizaines de milliers de fichiers pour lancer Vitest serait absurde,
 * et on ne fait que lire ce dossier — la config générée enferme le cache de Vite dans
 * `.learn/.vite` justement pour que rien ne soit écrit à travers ce lien (D25).
 *
 * D26 : la liste des fichiers vient de **git** quand le projet est un dépôt
 * (`git ls-files -c -o --exclude-standard`, donc suivis + non suivis non ignorés). Mesuré
 * sur de vrais dépôts, aucune liste d'exclusion codée en dur ne tient : un projet de 740 Mo
 * dont 733 Mo dans un `.jarvis/` maison passe entre les mailles, alors que `.gitignore` le
 * connaît déjà. La liste ci-dessus reste le filet pour les projets hors git.
 *
 * Rien n'est écrit dans le projet de l'utilisateur : tout se passe dans le temporaire système.
 */
async function cloneWorkspace(
  root: ResolvedPath,
  log: (line: string) => void
): Promise<Result<ResolvedPath>> {
  let dir: string
  try {
    const files = await listFiles(root)
    const bytes = files.reduce((total, file) => total + file.size, 0)
    if (bytes > SIZE_WARNING_BYTES) {
      log(
        `Avertissement : la copie temporaire du projet pèse ${Math.round(bytes / 1024 / 1024)} Mo (${files.length} fichiers). La vérification des solutions va être longue ; si le projet contient de gros dossiers générés, ajoute-les au .gitignore pour qu'ils soient écartés.`
      )
    }

    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'learnpath-verify-'))
    const made = new Set<string>()
    for (const file of files) {
      const destination = path.join(dir, file.relative)
      const parent = path.dirname(destination)
      if (!made.has(parent)) {
        await fs.mkdir(parent, { recursive: true })
        made.add(parent)
      }
      await fs.copyFile(path.join(root, file.relative), destination)
    }
  } catch (error) {
    return err(
      `La vérification des solutions n'a pas pu être faite : copie du projet impossible (${error instanceof Error ? error.message : String(error)}).`
    )
  }

  await mirrorNodeModules(root, dir)

  const resolved = safeResolve(dir, '.', { allowRoot: true })
  return resolved.ok ? ok(resolved.value) : err(resolved.error)
}

/**
 * `node_modules` du bac à sable : **un lien par entrée**, pas un lien sur le dossier.
 *
 * Un lien sur le dossier entier partage le vrai `node_modules` en écriture, et Vite y écrit
 * vraiment : `node_modules/.vite/` pour son cache, et `node_modules/.vite-temp/` pour la
 * version transpilée du fichier de config (`findNearestNodeModules`, non configurable).
 * On casserait la règle « rien hors de .learn/ » à chaque vérification de solutions.
 * En reliant chaque entrée, tout ce que Vite crée à la racine de `node_modules` est créé
 * dans le temporaire, qui est supprimé ensuite. Les paquets, eux, restent lus sur place.
 */
async function mirrorNodeModules(root: ResolvedPath, sandbox: string): Promise<void> {
  const source = path.join(root, 'node_modules')
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(source, { withFileTypes: true })
  } catch {
    // Absent (Yarn PnP, dépendances jamais installées) : le run échouera avec le message
    // de `vitestCli`, qui dit précisément quoi faire. Ici, on n'a rien à ajouter.
    return
  }

  const destination = path.join(sandbox, 'node_modules')
  await fs.mkdir(destination, { recursive: true })
  for (const entry of entries) {
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    try {
      // `isDirectory()` est faux pour un lien : pnpm relie ses paquets vers le magasin.
      const info = await fs.stat(from)
      if (info.isDirectory()) await fs.symlink(from, to, 'junction')
      else await fs.copyFile(from, to)
    } catch {
      /* entrée illisible : le run dira ce qui manque */
    }
  }
}

interface Entry {
  readonly relative: string
  readonly size: number
}

async function listFiles(root: ResolvedPath): Promise<readonly Entry[]> {
  const tracked = await gitFiles(root)
  // `.learn/` est toujours ajouté au parcours : un projet qui l'ignore en bloc dans son
  // `.gitignore` donnerait une copie sans tests, donc un échec incompréhensible.
  const paths =
    tracked === undefined
      ? await walk(root, '')
      : [...new Set([...tracked, ...(await walk(root, '.learn'))])]

  const entries: Entry[] = []
  for (const relative of paths) {
    if (relative.split(/[\/]/).some((segment) => EXCLUDED_DIRS.has(segment))) continue
    try {
      const info = await fs.stat(path.join(root, relative))
      if (info.isFile()) entries.push({ relative, size: info.size })
    } catch {
      // Lien symbolique cassé, fichier supprimé entre-temps : on ne le copie pas.
    }
  }
  return entries
}

/** `undefined` si le projet n'est pas un dépôt git, ou si git n'est pas installé. */
function gitFiles(root: ResolvedPath): Promise<readonly string[] | undefined> {
  return new Promise((resolve) => {
    const child = spawn('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], {
      cwd: root,
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out = `${out}${chunk.toString()}`
    })
    child.on('error', () => resolve(undefined))
    child.on('close', (code) =>
      resolve(code === 0 ? out.split('\u0000').filter((name) => name !== '') : undefined)
    )
  })
}

/** Parcours récursif, `EXCLUDED_DIRS` élagués. Chemins relatifs à `root`. */
async function walk(root: string, relative: string): Promise<readonly string[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(path.join(root, relative), { withFileTypes: true })
  } catch {
    return []
  }

  const found: string[] = []
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue
    const child = relative === '' ? entry.name : path.join(relative, entry.name)
    if (entry.isDirectory()) found.push(...(await walk(root, child)))
    else found.push(child)
  }
  return found
}
