import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { composePrompt } from './prompt.js'

/**
 * Le gabarit lu ici est **le fichier livré**, pas une copie de test : c'est tout l'objet de
 * la fonctionnalité. Si `prompts/generer-parcours.md` perd un champ ou en renomme un, ces
 * tests tombent avant que le prompt périmé n'atteigne le presse-papiers de quelqu'un.
 */
const TEMPLATE = readFileSync('prompts/generer-parcours.md', 'utf8')

function compose(fields: Parameters<typeof composePrompt>[1]): string {
  const result = composePrompt(TEMPLATE, fields)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

describe('composePrompt — le gabarit livré', () => {
  it('substitue les trois champs et ne laisse aucun marqueur', () => {
    const prompt = compose({
      feature: 'Un panier d’achat',
      level: 'débutant',
      files: 'src/panier/',
    })
    expect(prompt).toContain('La fonctionnalité que je veux coder : Un panier d’achat')
    expect(prompt).toContain('Mon niveau : débutant')
    expect(prompt).toContain('Fichiers ou dossiers concernés : src/panier/')
    expect(prompt).not.toMatch(/\{\{/)
  })

  it('porte les règles du format, pas seulement les champs', () => {
    const prompt = compose({ feature: 'x', level: 'intermédiaire' })
    expect(prompt).toContain('.learn/parcours/<slug>.json')
    expect(prompt).toContain('"kind": "vitest"')
    expect(prompt).toContain('step <id>')
    expect(prompt).toContain('SE COLLECTE')
  })

  it('efface la ligne des fichiers quand le champ est vide', () => {
    const sansFichiers = compose({ feature: 'x', level: 'débutant', files: '   ' })
    expect(sansFichiers).not.toContain('Fichiers ou dossiers concernés')
    // Et sans laisser une ligne vide au milieu des deux champs restants.
    expect(sansFichiers).toContain('Mon niveau : débutant\nLa fonctionnalité')
  })

  it('n’interprète pas les motifs de remplacement dans ce que l’utilisateur tape', () => {
    const prompt = compose({ feature: "un prix en $& et un $' littéral", level: 'débutant' })
    expect(prompt).toContain("un prix en $& et un $' littéral")
  })

  it('refuse une fonctionnalité vide — c’est le seul champ obligatoire', () => {
    const result = composePrompt(TEMPLATE, { feature: '  \n ', level: 'débutant' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('obligatoire')
  })

  it('refuse un niveau inconnu, sans le recopier tel quel dans le prompt', () => {
    const result = composePrompt(TEMPLATE, { feature: 'x', level: 'expert' })
    expect(result.ok).toBe(false)
  })

  it('refuse un gabarit dont un champ a été renommé, plutôt que de livrer le marqueur', () => {
    const result = composePrompt(TEMPLATE.replace('{{NIVEAU}}', '{{LEVEL}}'), {
      feature: 'x',
      level: 'débutant',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('{{LEVEL}}')
  })
})
