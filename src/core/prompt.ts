import { type Result, ok, err } from './result.js'

/**
 * Composition du prompt de génération à partir du gabarit unique
 * (`prompts/generer-parcours.md`, embarqué dans le paquet). Le gabarit n'est pas recopié
 * ici : il est lu par l'appelant et passé en argument, pour que le même texte serve à
 * l'extension, au README et à la spec. Le prompt a existé en deux exemplaires divergents,
 * et un parcours a été généré avec une version périmée — c'est la classe de bug que cette
 * fonction supprime.
 */

export const LEVELS = ['débutant', 'intermédiaire'] as const
export type Level = (typeof LEVELS)[number]

export interface PromptFields {
  /** La fonctionnalité à implémenter. Seul champ obligatoire. */
  readonly feature: string
  readonly level: string
  /** Fichiers ou dossiers à regarder en priorité. Facultatif. */
  readonly files?: string
}

export function composePrompt(template: string, fields: PromptFields): Result<string> {
  const feature = fields.feature.trim()
  if (feature === '') {
    return err('Décris la fonctionnalité à implémenter : c’est le seul champ obligatoire.')
  }
  if (!isLevel(fields.level)) {
    return err(`Niveau inconnu : « ${fields.level} ». Attendu : ${LEVELS.join(' ou ')}.`)
  }

  const files = (fields.files ?? '').trim()
  // Remplacement par fonction et jamais par chaîne : un `$&` ou un `$'` dans ce que
  // l'utilisateur a tapé serait interprété par `String.replace`.
  const composed = template
    .replace('{{NIVEAU}}', () => fields.level)
    .replace(
      '{{FICHIERS}}\n',
      () => (files === '' ? '' : `Fichiers ou dossiers concernés : ${files}\n`)
    )
    .replace('{{FONCTIONNALITE}}', () => feature)

  // Le gabarit est un fichier à part : un champ renommé doit se voir ici, pas dans le
  // presse-papiers de l'utilisateur.
  const left = /\{\{[A-Z_]+\}\}/.exec(composed)
  if (left !== null) {
    return err(`Gabarit de prompt incomplet : ${left[0]} n’a pas été remplacé.`)
  }
  return ok(composed)
}

function isLevel(value: string): value is Level {
  return (LEVELS as readonly string[]).includes(value)
}
