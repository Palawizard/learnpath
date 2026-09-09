import * as fs from 'node:fs'
import * as path from 'node:path'
import { type Result, ok, err } from './result.js'

/**
 * Sous Windows, `npm`, `npx`, `yarn` et `pnpm` sont des `.cmd`, et depuis Node 22
 * `spawn` refuse de lancer un `.cmd` sans shell (`EINVAL`, suite à CVE-2024-27980).
 * Passer `shell: true` rouvrirait exactement la porte que D8 et D14 ont fermée : on
 * cherche donc, dans l'ordre, un exécutable natif puis le JS du CLI, qu'on lance avec le
 * Node courant. Si on ne trouve ni l'un ni l'autre, on rend la commande telle quelle et
 * l'échec est explicite.
 */
export function launcher(
  binary: string,
  args: readonly string[]
): { readonly file: string; readonly args: readonly string[] } {
  if (process.platform !== 'win32') return { file: binary, args }

  const native = onPath(`${binary}.exe`)
  if (native !== undefined) return { file: native, args }

  const cli = bundledCli(binary) ?? globalCli(binary)
  return cli === undefined ? { file: binary, args } : { file: process.execPath, args: [cli, ...args] }
}

/** `npm` et `npx` sont livrés avec Node : leur JS est à côté de l'exécutable. */
function bundledCli(binary: string): string | undefined {
  if (binary !== 'npm' && binary !== 'npx') return undefined
  return firstExisting([
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', `${binary}-cli.js`),
  ])
}

/**
 * `pnpm` et `yarn` installés globalement par npm : le `.cmd` est dans un dossier du PATH,
 * et le JS qu'il appelle est juste à côté, sous `node_modules/`. C'est ce JS qu'on lance.
 */
function globalCli(binary: string): string | undefined {
  const shim = onPath(`${binary}.cmd`)
  if (shim === undefined) return undefined
  const base = path.join(path.dirname(shim), 'node_modules', binary, 'bin')
  return firstExisting([
    path.join(base, `${binary}.cjs`),
    path.join(base, `${binary}.js`),
    path.join(base, `${binary}.mjs`),
  ])
}

function onPath(name: string): string | undefined {
  const dirs = (process.env['PATH'] ?? '').split(path.delimiter).filter((dir) => dir !== '')
  return firstExisting(dirs.map((dir) => path.join(dir, name)))
}

function firstExisting(candidates: readonly string[]): string | undefined {
  return candidates.find((candidate) => fs.existsSync(candidate))
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
