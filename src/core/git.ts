import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { type Result, ok, err } from './result.js'
import { launcher } from './exec.js'

/**
 * Le strict nécessaire de git, en plomberie. Aucune commande ne touche HEAD, la branche,
 * l'index ni l'arbre de travail en dehors des chemins qu'on lui donne explicitement : les
 * commits de LearnPath sont fabriqués dans un index temporaire et rattachés à une
 * référence à nous, sous `refs/learnpath/`. L'historique de l'utilisateur n'est jamais
 * réécrit, et son travail en cours n'est jamais emporté (D36).
 */

/** Une référence par étape, hors de `refs/tags` et de `refs/heads`. */
export const REFS = 'refs/learnpath'
/** Instantané pris juste avant une restauration : ce qu'on remplace reste récupérable. */
export const BACKUP_REFS = 'refs/learnpath-backup'

export function baseRef(slug: string): string {
  return `${REFS}/${slug}/base`
}

export function stepRef(slug: string, stepId: string): string {
  return `${REFS}/${slug}/${stepId}`
}

export function backupRef(slug: string, stepId: string, stamp: string): string {
  return `${BACKUP_REFS}/${slug}/${stepId}-${stamp}`
}

/**
 * Un composant de référence git valide. Le schéma du parcours autorise pour un id des
 * formes que git refuse (`..`, un point final, un suffixe `.lock`), et `base` est déjà pris
 * par la référence de départ. Un parcours qui en contient désactive la fonctionnalité au
 * lieu de la faire échouer au clic.
 */
export function isRefSafe(component: string): boolean {
  if (component === '' || component === 'base') return false
  if (component.includes('..') || component.startsWith('.') || component.endsWith('.')) return false
  if (component.endsWith('.lock')) return false
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(component)
}

const GIT_MISSING =
  "« git » est introuvable depuis VSCode : LearnPath ne peut pas créer de point de restauration."

interface GitOutput {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** Lance git sans shell. N'échoue que si le binaire est introuvable ou ne démarre pas. */
async function runGit(
  cwd: string,
  args: readonly string[],
  indexFile?: string
): Promise<Result<GitOutput>> {
  const launch = launcher('git', args)
  if (!launch.resolved) return err(GIT_MISSING)

  return new Promise((resolve) => {
    const child = spawn(launch.file, [...launch.args], {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(indexFile === undefined
        ? {}
        : { env: { ...process.env, GIT_INDEX_FILE: indexFile } }),
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => resolve(err(`${GIT_MISSING} (${error.message})`)))
    child.on('close', (code) => resolve(ok({ code: code ?? 1, stdout, stderr })))
  })
}

/** Sortie d'une commande qui doit réussir. L'erreur porte le stderr de git, tel quel. */
async function text(cwd: string, args: readonly string[], indexFile?: string): Promise<Result<string>> {
  const result = await runGit(cwd, args, indexFile)
  if (!result.ok) return result
  if (result.value.code !== 0) {
    const name = args.find((arg) => !arg.startsWith('-')) ?? ''
    return err(`git ${name} a échoué : ${result.value.stderr.trim() || `code ${result.value.code}`}`)
  }
  return ok(result.value.stdout.trim())
}

/** `undefined` quand la commande sort en erreur : c'est une question, pas une opération. */
async function ask(cwd: string, args: readonly string[]): Promise<string | undefined> {
  const result = await runGit(cwd, args)
  if (!result.ok || result.value.code !== 0) return undefined
  return result.value.stdout.trim()
}

/** `undefined` si le dossier n'est pas dans un dépôt git. */
export function repositoryRoot(cwd: string): Promise<string | undefined> {
  return ask(cwd, ['rev-parse', '--show-toplevel'])
}

/**
 * Le chemin du dossier ouvert vu depuis la racine du dépôt, `''` à la racine. Les
 * pathspecs sont relatifs au dossier courant, mais `<ref>:<chemin>` est toujours relatif à
 * la racine du dépôt : c'est le seul endroit où ce préfixe sert.
 */
export async function pathPrefix(cwd: string): Promise<string> {
  return (await ask(cwd, ['rev-parse', '--show-prefix'])) ?? ''
}

/** `undefined` sur un dépôt sans aucun commit : il n'y a pas d'état de départ à référencer. */
export function headCommit(cwd: string): Promise<string | undefined> {
  return ask(cwd, ['rev-parse', 'HEAD'])
}

export function refCommit(cwd: string, ref: string): Promise<string | undefined> {
  return ask(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
}

/**
 * Propreté de l'arbre **du dossier ouvert**, fichiers non suivis exclus : eux ne gênent
 * aucune restauration, alors qu'une modification non commitée d'un fichier suivi rendrait
 * l'état de départ faux.
 */
export async function isWorkingTreeClean(cwd: string): Promise<boolean> {
  const status = await ask(cwd, ['status', '--porcelain', '--untracked-files=no', '--', '.'])
  return status === ''
}

/** `--create-reflog` : une référence remplacée garde sa valeur précédente dans son reflog. */
export async function updateRef(cwd: string, ref: string, commit: string): Promise<Result<void>> {
  const result = await text(cwd, ['update-ref', '--create-reflog', ref, commit])
  return result.ok ? ok(undefined) : err(result.error)
}

/** Le fichier existe-t-il dans l'arbre de cette référence ? */
export async function hasPathInRef(cwd: string, ref: string, repoPath: string): Promise<boolean> {
  const result = await runGit(cwd, ['cat-file', '-e', `${ref}:${repoPath}`])
  return result.ok && result.value.code === 0
}

export interface CommitRequest {
  /** Référence ou SHA du commit parent : son arbre sert de base. */
  readonly parent: string
  /** Chemins relatifs au dossier ouvert. Rien d'autre n'entre dans le commit. */
  readonly files: readonly string[]
  readonly message: string
}

/**
 * Un commit contenant l'arbre du parent, plus ces fichiers-là et rien d'autre. Tout se
 * passe dans un `GIT_INDEX_FILE` temporaire : l'index de l'utilisateur, sa branche et son
 * arbre de travail ne bougent pas, et son travail en cours ailleurs ne peut pas être
 * emporté — c'est exactement ce qu'un `git add -A` aurait fait.
 *
 * `add -f` : un fichier d'étape peut être ignoré par le `.gitignore` du projet, il doit
 * quand même entrer dans notre chaîne, sinon la reprise de l'étape suivante ne le
 * retrouverait pas.
 */
export async function commitPaths(cwd: string, request: CommitRequest): Promise<Result<string>> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'learnpath-index-'))
  const indexFile = path.join(dir, 'index')
  try {
    const read = await text(cwd, ['read-tree', request.parent], indexFile)
    if (!read.ok) return read

    const added = await text(cwd, ['add', '-f', '--', ...request.files], indexFile)
    if (!added.ok) return added

    const tree = await text(cwd, ['write-tree'], indexFile)
    if (!tree.ok) return tree

    // L'identité est la nôtre : ces commits sont ceux de LearnPath, et un dépôt où
    // `user.email` n'est pas réglé ne doit pas faire échouer le point de restauration.
    return await text(cwd, [
      '-c',
      'user.name=LearnPath',
      '-c',
      'user.email=learnpath@localhost',
      'commit-tree',
      tree.value,
      '-p',
      request.parent,
      '-m',
      request.message,
    ])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

/**
 * Réécrit ces fichiers-là depuis l'arbre de la référence. `restore --worktree` ne touche
 * ni l'index ni HEAD : seul le contenu des chemins donnés change sur le disque.
 */
export async function restorePaths(
  cwd: string,
  ref: string,
  files: readonly string[]
): Promise<Result<void>> {
  if (files.length === 0) return ok(undefined)
  const result = await text(cwd, ['restore', '--source', ref, '--worktree', '--', ...files])
  return result.ok ? ok(undefined) : err(result.error)
}
