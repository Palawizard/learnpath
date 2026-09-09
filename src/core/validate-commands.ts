import { type Result, ok, err } from './result.js'

/**
 * `runner.command` et `runner.setup` viennent d'un JSON généré par un LLM et finiront
 * exécutés sur la machine de l'utilisateur. Liste blanche, pas liste noire : on n'autorise
 * que les gestionnaires de paquets, et on refuse tout ce qui pourrait enchaîner une
 * deuxième commande si un jour l'exécution passait par un shell. Voir D8.
 */
const ALLOWED_BINARIES: ReadonlySet<string> = new Set(['npm', 'npx', 'pnpm', 'yarn'])

// & | ; < > ` $ ( ) antislash, saut de ligne, retour chariot, et l'octet nul.
const SHELL_METACHARACTERS = /[&|;<>`$()\\\n\r\u0000]/

export function validateCommand(command: string): Result<string> {
  if (typeof command !== 'string' || command.trim() === '') {
    return err('la commande est vide')
  }

  const found = command.match(SHELL_METACHARACTERS)
  if (found) {
    return err(
      `la commande contient le métacaractère shell « ${found[0] === '\n' ? '\\n' : found[0]} » : ${command}`
    )
  }

  const binary = command.trim().split(/\s+/)[0] ?? ''
  if (!ALLOWED_BINARIES.has(binary)) {
    return err(
      `la commande doit commencer par ${[...ALLOWED_BINARIES].join(', ')} (reçu « ${binary} ») : ${command}`
    )
  }

  return ok(command.trim())
}
