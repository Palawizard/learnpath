import * as path from 'node:path'
import { type Result, ok, err } from './result.js'

/**
 * Un chemin absolu dont on a prouvé qu'il est sous la racine du workspace. Seul
 * `safeResolve` peut en fabriquer un : toute fonction qui écrit sur disque exige ce type,
 * donc le compilateur refuse une écriture sur un chemin brut. Le lot 1 validait les
 * chemins contre une racine fictive ; sans cette marque, rien n'empêchait le lot 2
 * d'écrire à partir d'une chaîne jamais re-résolue contre le vrai workspace.
 */
export type ResolvedPath = string & { readonly __brand: 'ResolvedPath' }

export interface SafeResolveOptions {
  /** Accepter la racine elle-même (`.`). Utilisé pour `runner.cwd`. */
  readonly allowRoot?: boolean
}

/**
 * Les chemins d'un parcours viennent d'un JSON généré par un LLM : on les traite comme
 * hostiles. On refuse la forme du chemin *avant* de le résoudre, puis on revérifie le
 * résultat — un `startsWith` sur la chaîne résolue seul se contourne (`/root` vs
 * `/root-autre`), et une résolution seule laisse passer des formes qu'on ne veut pas
 * manipuler du tout (antislash, lettre de lecteur).
 */
export function safeResolve(
  root: string,
  candidate: string,
  options: SafeResolveOptions = {}
): Result<ResolvedPath> {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    return err('le chemin est vide')
  }
  if (candidate.includes('\u0000')) {
    return err(`le chemin contient un octet nul : ${JSON.stringify(candidate)}`)
  }
  if (/[\n\r]/.test(candidate)) {
    return err(`le chemin contient un saut de ligne : ${JSON.stringify(candidate)}`)
  }
  if (candidate.includes('\\')) {
    return err(
      `le chemin contient un antislash, utilise « / » : ${JSON.stringify(candidate)}`
    )
  }
  if (
    path.posix.isAbsolute(candidate) ||
    path.win32.isAbsolute(candidate) ||
    /^[a-zA-Z]:/.test(candidate)
  ) {
    return err(`le chemin est absolu, il doit être relatif au projet : ${candidate}`)
  }
  if (candidate.split('/').includes('..')) {
    return err(`le chemin remonte hors du projet avec « .. » : ${candidate}`)
  }

  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, candidate)
  const relative = path.relative(resolvedRoot, resolved)
  if (relative === '') {
    return options.allowRoot === true
      ? ok(resolved as ResolvedPath)
      : err(`le chemin sort du projet : ${candidate}`)
  }
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return err(`le chemin sort du projet : ${candidate}`)
  }

  return ok(resolved as ResolvedPath)
}
