import * as fs from 'node:fs'
import * as path from 'node:path'
import { type Result, ok, err } from './result.js'

export interface Launch {
  readonly file: string
  readonly args: readonly string[]
  /** Chemins réellement examinés, dans l'ordre. Sert au diagnostic quand rien n'aboutit. */
  readonly tried: readonly string[]
  /** `false` : aucun exécutable trouvé. L'appelant explique au lieu de laisser un ENOENT. */
  readonly resolved: boolean
}

/**
 * Où est `npm` (ou `npx`, `pnpm`, `yarn`) vu depuis l'hôte d'extension.
 *
 * Deux pièges, tous les deux constatés en vrai :
 * - l'hôte d'extension n'a **pas** le PATH d'un terminal. Avec nvm, fnm ou volta, `npm`
 *   marche dans le terminal et donne `spawn npm ENOENT` ici (D29) ;
 * - sous Windows ces commandes sont des `.cmd`, et depuis Node 22 `spawn` refuse de lancer
 *   un `.cmd` sans shell (EINVAL, suite à CVE-2024-27980). `shell: true` rouvrirait la
 *   porte que D8 et D14 ont fermée : on lance donc le JS du CLI avec le Node courant.
 *
 * Ordre : le CLI livré avec le Node qui exécute l'hôte, puis le PATH. L'environnement du
 * terminal intégré de VSCode est la troisième source ; il est fusionné dans `process.env`
 * par `extension.ts` (le code de `src/core` n'importe pas `vscode`), donc il arrive ici
 * par le PATH.
 */
export function launcher(binary: string, args: readonly string[]): Launch {
  const tried: string[] = []
  const found = (candidates: readonly string[]): string | undefined => {
    tried.push(...candidates)
    return firstExisting(candidates)
  }

  const bundled = found(bundledCli(binary))
  if (bundled !== undefined) return { file: process.execPath, args: [bundled, ...args], tried, resolved: true }

  const native = found(onPath(process.platform === 'win32' ? `${binary}.exe` : binary))
  if (native !== undefined) return { file: native, args, tried, resolved: true }

  if (process.platform === 'win32') {
    // `npm.cmd` n'est pas lançable sans shell, mais le JS qu'il appelle est à côté.
    for (const shim of onPath(`${binary}.cmd`)) {
      tried.push(shim)
      if (!firstExisting([shim])) continue
      const cli = found(cliNames(path.dirname(shim), binary))
      if (cli !== undefined) return { file: process.execPath, args: [cli, ...args], tried, resolved: true }
    }
  }

  return { file: binary, args, tried, resolved: false }
}

/** Le message à donner quand `launcher` n'a rien trouvé : diagnostic complet, puis l'issue. */
export function notFoundMessage(command: string, launch: Launch): string {
  const binary = command.trim().split(/\s+/)[0] ?? ''
  const why = PYTHON_FAMILY.has(binary)
    ? `Aucun interpréteur Python n'a été trouvé depuis VSCode pour « ${binary} » : ni environnement virtuel dans le projet (.venv, venv), ni VIRTUAL_ENV, ni python3 ou python dans le PATH de l'hôte d'extension.`
    : `« ${binary} » est introuvable depuis VSCode. L'hôte d'extension n'a pas le PATH de ton terminal : c'est le cas courant avec nvm, fnm ou volta.`
  return [
    why,
    `Lance la commande toi-même dans un terminal, à la racine du projet :`,
    `    ${command}`,
    `puis relance l'import avec un setup vide ("setup": []) dans le fichier de parcours.`,
    ``,
    `Diagnostic — chemins examinés :`,
    ...launch.tried.map((candidate) => `    ${candidate}`),
    `process.execPath : ${process.execPath}`,
    `PATH vu par l'hôte : ${process.env['PATH'] ?? '(vide)'}`,
  ].join('\n')
}

/**
 * `npm` et `npx` sont livrés avec Node : leur JS est à côté de l'exécutable, ou une marche
 * plus haut sous `lib/` (installations POSIX, nvm compris).
 */
function bundledCli(binary: string): readonly string[] {
  const dir = path.dirname(process.execPath)
  return [...cliNames(dir, binary), ...cliNames(path.join(dir, '..', 'lib'), binary)]
}

/** Les noms sous lesquels un paquet expose son CLI en JS. `npm` utilise `npm-cli.js`. */
function cliNames(dir: string, binary: string): readonly string[] {
  const base = path.join(dir, 'node_modules', binary, 'bin')
  return [`${binary}-cli.js`, `${binary}.cjs`, `${binary}.js`, `${binary}.mjs`].map((name) =>
    path.join(base, name)
  )
}

function onPath(name: string): readonly string[] {
  const dirs = (process.env['PATH'] ?? '').split(path.delimiter).filter((dir) => dir !== '')
  return dirs.map((dir) => path.join(dir, name))
}

function firstExisting(candidates: readonly string[]): string | undefined {
  return candidates.find((candidate) => fs.existsSync(candidate))
}

// --- Python (D39) ---------------------------------------------------------------------

/** Commandes de setup qui s'exécutent avec l'interpréteur Python du projet. */
const PYTHON_FAMILY: ReadonlySet<string> = new Set(['python', 'python3', 'pip', 'pip3'])

/** Environnements virtuels reconnus dans le projet, dans l'ordre. */
const VENV_DIRS = ['.venv', 'venv'] as const

export function venvPython(venv: string): string {
  return process.platform === 'win32'
    ? path.join(venv, 'Scripts', 'python.exe')
    : path.join(venv, 'bin', 'python')
}

/**
 * L'interpréteur Python qui fait tourner les tests. Ordre : l'environnement virtuel du
 * projet (le premier dossier de `dirs` qui en a un), celui qui est activé (`VIRTUAL_ENV`),
 * puis le Python du système. C'est l'ordre dans lequel un développeur Python s'attend à
 * voir son code exécuté : un pytest installé dans `.venv` ne sert à rien si on lance celui
 * du système.
 */
export function pythonFor(dirs: readonly string[]): Launch {
  const tried: string[] = []
  const found = (candidates: readonly string[]): string | undefined => {
    tried.push(...candidates)
    return firstExisting(candidates)
  }

  const local = found([...new Set(dirs)].flatMap((dir) => VENV_DIRS.map((venv) => venvPython(path.join(dir, venv)))))
  if (local !== undefined) return { file: local, args: [], tried, resolved: true }

  const active = process.env['VIRTUAL_ENV']
  const activated = active === undefined || active === '' ? undefined : found([venvPython(active)])
  if (activated !== undefined) return { file: activated, args: [], tried, resolved: true }

  const system = systemPython(tried)
  return system === undefined
    ? { file: 'python3', args: [], tried, resolved: false }
    : { file: system, args: [], tried, resolved: true }
}

/**
 * Le Python du PATH. Sous Windows, les alias `WindowsApps\python.exe` existent sur le disque
 * mais ouvrent le Microsoft Store au lieu de lancer quoi que ce soit : on les écarte.
 */
function systemPython(tried: string[]): string | undefined {
  const names = process.platform === 'win32' ? ['python.exe', 'py.exe'] : ['python3', 'python']
  const candidates = names.flatMap(onPath).filter((candidate) => !/[\\/]WindowsApps[\\/]/i.test(candidate))
  tried.push(...candidates)
  return firstExisting(candidates)
}

/**
 * Comment lancer une commande de `runner.setup`, déjà validée par `validateCommand`.
 *
 * - `pip …` devient `<python du projet> -m pip …` : le `pip` du PATH installerait dans un
 *   autre Python que celui qui lance les tests ;
 * - `python -m venv <dossier>` part du Python **du système** — recréer un venv avec son
 *   propre interpréteur échoue sous Windows — et n'est pas rejoué si l'environnement existe
 *   déjà : un réimport ne doit pas reconstruire un venv plein de paquets ;
 * - le reste (`npm`, `uv`, `poetry`…) passe par `launcher`.
 */
export function setupLauncher(command: string, cwd: string): Launch & { readonly skip?: string } {
  const [binary = '', ...args] = command.trim().split(/\s+/)
  if (binary === 'pip' || binary === 'pip3') {
    const python = pythonFor([cwd])
    return { ...python, args: [...python.args, '-m', 'pip', ...args] }
  }
  if (binary === 'python' || binary === 'python3') {
    if (args[0] === '-m' && args[1] === 'venv') {
      const target = args.slice(2).find((arg) => !arg.startsWith('-'))
      if (target !== undefined && fs.existsSync(venvPython(path.resolve(cwd, target)))) {
        return { file: binary, args, tried: [], resolved: true, skip: `L'environnement ${target} existe déjà : « ${command} » n'est pas rejouée.` }
      }
      const tried: string[] = []
      const system = systemPython(tried)
      return { file: system ?? binary, args, tried, resolved: system !== undefined }
    }
    const python = pythonFor([cwd])
    return { ...python, args: [...python.args, ...args] }
  }
  return launcher(binary, args)
}

/**
 * Le CLI de Vitest installé dans le projet de l'utilisateur. On ne passe plus par `npx` :
 * il est plus lent, et sous Windows il n'est pas lançable sans shell.
 *
 * pnpm passe par ici sans rien de particulier : son `node_modules/vitest` est un lien vers
 * le magasin, et `existsSync` le suit. Yarn Plug'n'Play, lui, n'a pas de `node_modules` du
 * tout — il n'y a rien à résoudre, et il vaut mieux le dire que laisser croire à une
 * installation ratée.
 */
export function vitestCli(root: string): Result<string> {
  const candidate = path.join(root, 'node_modules', 'vitest', 'vitest.mjs')
  if (fs.existsSync(candidate)) return ok(candidate)

  if (firstExisting([path.join(root, '.pnp.cjs'), path.join(root, '.pnp.js')]) !== undefined) {
    return err(
      "Ce projet utilise Yarn Plug'n'Play : il n'y a pas de dossier node_modules, et LearnPath ne sait pas lancer Vitest dans ce mode. Passe le projet en « nodeLinker: node-modules » (fichier .yarnrc.yml) pour utiliser LearnPath."
    )
  }
  return err(
    "Vitest n'est pas installé dans ce projet (node_modules/vitest est introuvable). Réimporte le parcours pour relancer son installation."
  )
}
