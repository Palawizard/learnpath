import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { humanize } from './humanize.js'
import { parseResult } from '../runner/parse.js'

/** Messages réels : on ne teste jamais `humanize` sur une chaîne écrite à la main. */
function messages(name: string): Map<string, string> {
  const parsed = parseResult(readFileSync(`src/runner/__fixtures__/${name}.json`, 'utf8'))
  if (!parsed.ok) throw new Error(`${name} : ${parsed.error}`)
  const out = new Map<string, string>()
  for (const file of parsed.value.files) {
    if (file.message !== '') out.set(file.name.replace(/[\/]+/g, '/').split('/').pop() ?? '', file.message)
    for (const assertion of file.assertions) {
      const first = assertion.failureMessages[0]
      if (first !== undefined) out.set(assertion.fullName, first)
    }
  }
  return out
}

const frequents = messages('g-messages-frequents')

function traduction(clef: string): string {
  const raw = [...frequents].find(([name]) => name.includes(clef))?.[1]
  if (raw === undefined) throw new Error(`aucun message pour « ${clef} » dans la fixture`)
  const human = humanize(raw)
  if (human === undefined) throw new Error(`forme non reconnue : ${raw.split('\n')[0]}`)
  return human
}

describe('humanize', () => {
  it("nomme le symbole qui n'est pas une fonction, sans trancher entre export manquant et mauvais type", () => {
    const text = traduction('step 2.1')
    expect(text).toContain('« add »')
    expect(text).toContain("le module ne l'exporte pas encore")
  })

  it('sépare obtenu et attendu sur une comparaison profonde', () => {
    const text = traduction('step 2.2')
    expect(text).toContain('Obtenu : { total: 1, lignes: [] }')
    expect(text).toContain('Attendu : { total: +0, lignes: [], remise: null }')
  })

  it('dit quelle propriété était lue quand une valeur est undefined', () => {
    const text = traduction('step 2.3')
    expect(text).toContain('undefined')
    expect(text).toContain('« nom »')
  })

  it("traduit le dépassement de délai malgré le message vidé par Vitest", () => {
    expect(traduction('step 2.4')).toContain('dépassé son délai')
  })

  it("traite l'export manquant comme un « is not a function », parce que c'est ce que Vitest dit", () => {
    expect(traduction('step 2.5')).toContain('« total »')
  })

  it('reconnaît le module introuvable sur la fixture du fichier pas encore créé', () => {
    const raw = [...messages('a-fichier-absent').values()][0]
    expect(humanize(raw ?? '')).toContain('« ../../src/panier.js » est introuvable')
  })

  it('reconnaît la source illisible sur la fixture de syntaxe invalide', () => {
    const raw = [...messages('b-syntaxe-invalide').values()][0]
    expect(humanize(raw ?? '')).toContain("n'est pas du JavaScript valide")
  })

  it('laisse passer une forme inconnue sans la reformuler', () => {
    expect(humanize('Error: quelque chose de jamais vu')).toBeUndefined()
    expect(humanize('')).toBeUndefined()
  })

  it('coupe le commentaire « // Object.is equality » de Vitest', () => {
    expect(humanize('AssertionError: expected 5 to be 3 // Object.is equality')).toBe(
      'Obtenu : 5\nAttendu : 3'
    )
  })
})
