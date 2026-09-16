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

const BASE = { level: 'débutant', languageLevel: 'je découvre la syntaxe' } as const

describe('composePrompt — le gabarit livré', () => {
  it('substitue tous les champs et ne laisse aucun marqueur', () => {
    const prompt = compose({
      ...BASE,
      feature: 'Un panier d’achat',
      known: 'les fonctions',
      files: 'src/panier/',
    })
    expect(prompt).toContain('La fonctionnalité que je veux coder : Un panier d’achat')
    expect(prompt).toContain('Mon niveau en programmation : débutant')
    expect(prompt).toContain('Mon niveau dans ce langage ou ce framework : je découvre la syntaxe')
    expect(prompt).toContain('Ce que je connais déjà : les fonctions')
    expect(prompt).toContain('Fichiers ou dossiers concernés : src/panier/')
    expect(prompt).not.toMatch(/\{\{/)
  })

  it('porte les règles du format, pas seulement les champs', () => {
    const prompt = compose({ ...BASE, feature: 'x', level: 'intermédiaire' })
    expect(prompt).toContain('.learn/parcours/<slug>.json')
    expect(prompt).toContain('"kind": "vitest"')
    expect(prompt).toContain('step <id>')
    expect(prompt).toContain('SE COLLECTE')
  })

  it('porte les règles pédagogiques que l’import fait respecter (D40 à D43)', () => {
    const prompt = compose({ ...BASE, feature: 'x' })
    // Le périmètre est annoncé avant la génération, et découpé s'il ne tient pas.
    expect(prompt).toContain('AVANT d\'écrire quoi que ce soit')
    expect(prompt).toContain('"notCovered"')
    // Les exemples de syntaxe, le squelette et la limite de taille sont décrits.
    expect(prompt).toContain('"examples"')
    expect(prompt).toContain('"scaffold"')
    expect(prompt).toContain('au plus 20 lignes')
    // Chaque niveau de langage proposé par le formulaire est expliqué au générateur.
    for (const level of ['je découvre la syntaxe', 'je connais les bases', "à l'aise"]) {
      expect(prompt).toContain(`« ${level} »`)
    }
  })

  it('efface les lignes facultatives quand elles sont vides', () => {
    const prompt = compose({ ...BASE, feature: 'x', known: ' ', files: '   ' })
    expect(prompt).not.toContain('Fichiers ou dossiers concernés')
    expect(prompt).not.toContain('Ce que je connais déjà')
    // Et sans laisser de ligne vide au milieu des champs restants.
    expect(prompt).toContain('je découvre la syntaxe\nLa fonctionnalité')
  })

  it('n’interprète pas les motifs de remplacement dans ce que l’utilisateur tape', () => {
    const prompt = compose({ ...BASE, feature: "un prix en $& et un $' littéral" })
    expect(prompt).toContain("un prix en $& et un $' littéral")
  })

  it('refuse une fonctionnalité vide — c’est le seul champ obligatoire', () => {
    const result = composePrompt(TEMPLATE, { ...BASE, feature: '  \n ' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('obligatoire')
  })

  it('refuse un niveau inconnu, dans l’un ou l’autre champ', () => {
    expect(composePrompt(TEMPLATE, { ...BASE, feature: 'x', level: 'expert' }).ok).toBe(false)
    expect(composePrompt(TEMPLATE, { ...BASE, feature: 'x', languageLevel: 'expert' }).ok).toBe(false)
  })

  it('refuse un gabarit dont un champ a été renommé, plutôt que de livrer le marqueur', () => {
    const result = composePrompt(TEMPLATE.replace('{{NIVEAU_LANGAGE}}', '{{LANGUE}}'), { ...BASE, feature: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('{{LANGUE}}')
  })
})
