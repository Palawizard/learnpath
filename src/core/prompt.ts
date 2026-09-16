import { type Result, ok, err } from './result.js'

/**
 * Composition du prompt de génération à partir du gabarit unique
 * (`prompts/generer-parcours.md`, embarqué dans le paquet). Le gabarit n'est pas recopié
 * ici : il est lu par l'appelant et passé en argument, pour que le même texte serve à
 * l'extension, au README et à la spec. Le prompt a existé en deux exemplaires divergents,
 * et un parcours a été généré avec une version périmée — c'est la classe de bug que cette
 * fonction supprime.
 */

/** Niveau en programmation, tous langages confondus. */
export const LEVELS = ['débutant', 'intermédiaire', 'avancé'] as const
export type Level = (typeof LEVELS)[number]

/**
 * Niveau dans le langage ou le framework du projet (D43). C'est lui qui décide si le
 * parcours doit montrer la syntaxe : on peut être intermédiaire en programmation et
 * découvrir React.
 */
export const LANGUAGE_LEVELS = ['je découvre la syntaxe', 'je connais les bases', "à l'aise"] as const
export type LanguageLevel = (typeof LANGUAGE_LEVELS)[number]

export interface PromptFields {
  /** La fonctionnalité à implémenter. Seul champ obligatoire. */
  readonly feature: string
  readonly level: string
  readonly languageLevel: string
  /** Ce que l'utilisateur connaît déjà. Facultatif. */
  readonly known?: string
  /** Fichiers ou dossiers à regarder en priorité. Facultatif. */
  readonly files?: string
}

export function composePrompt(template: string, fields: PromptFields): Result<string> {
  const feature = fields.feature.trim()
  if (feature === '') {
    return err('Décris la fonctionnalité à implémenter : c’est le seul champ obligatoire.')
  }
  if (!(LEVELS as readonly string[]).includes(fields.level)) {
    return err(`Niveau inconnu : « ${fields.level} ». Attendu : ${LEVELS.join(', ')}.`)
  }
  if (!(LANGUAGE_LEVELS as readonly string[]).includes(fields.languageLevel)) {
    return err(
      `Niveau dans le langage inconnu : « ${fields.languageLevel} ». Attendu : ${LANGUAGE_LEVELS.join(', ')}.`
    )
  }

  // Remplacement par fonction et jamais par chaîne : un `$&` ou un `$'` dans ce que
  // l'utilisateur a tapé serait interprété par `String.replace`.
  const composed = template
    .replace('{{NIVEAU}}', () => fields.level)
    .replace('{{NIVEAU_LANGAGE}}', () => fields.languageLevel)
    .replace('{{ACQUIS}}\n', () => optionalLine('Ce que je connais déjà', fields.known))
    .replace('{{FICHIERS}}\n', () => optionalLine('Fichiers ou dossiers concernés', fields.files))
    .replace('{{FONCTIONNALITE}}', () => feature)

  // Le gabarit est un fichier à part : un champ renommé doit se voir ici, pas dans le
  // presse-papiers de l'utilisateur.
  const left = /\{\{[A-Z_]+\}\}/.exec(composed)
  if (left !== null) {
    return err(`Gabarit de prompt incomplet : ${left[0]} n’a pas été remplacé.`)
  }
  return ok(composed)
}

/** Un champ facultatif vide efface sa ligne entière, sans laisser de ligne blanche. */
function optionalLine(label: string, value: string | undefined): string {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? '' : `${label} : ${trimmed}\n`
}
