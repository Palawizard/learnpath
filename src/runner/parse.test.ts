import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseResult } from './parse.js'

const fixture = (name: string): string =>
  readFileSync(`src/runner/__fixtures__/${name}.json`, 'utf8')

describe('parseResult sur les sorties Vitest réelles', () => {
  it('lit un rapport où aucun test n\'a pu être collecté', () => {
    const r = parseResult(fixture('a-fichier-absent'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.success).toBe(false)
    expect(r.value.numTotalTests).toBe(0)
    expect(r.value.files).toHaveLength(5)
    expect(r.value.files.every((f) => f.status === 'failed' && f.assertions.length === 0)).toBe(true)
    expect(r.value.files[0]?.message).toContain("Cannot find module '../../src/panier.js'")
  })

  it('lit les assertions, leur statut et leur message d\'échec', () => {
    const r = parseResult(fixture('c-assertion-echouee'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const assertions = r.value.files.flatMap((f) => f.assertions)
    expect(assertions).toHaveLength(15)
    const failed = assertions.filter((a) => a.status === 'failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]?.fullName).toBe('step 1.1 — panier vide a des lignes vides et aucune promo')
    expect(failed[0]?.failureMessages[0]).toContain('expected [ 1 ] to deeply equal []')
    // Les étapes non ciblées par le filtre `-t` sont `skipped`, surtout pas `passed`.
    expect(assertions.filter((a) => a.status === 'skipped')).toHaveLength(13)
  })

  it('lit un rapport entièrement vert', () => {
    const r = parseResult(fixture('d-tout-passe'))
    expect(r.ok && r.value.success).toBe(true)
    if (!r.ok) return
    expect(r.value.numTotalTests).toBe(15)
  })
})

describe('parseResult ne lève jamais', () => {
  const cas: ReadonlyArray<readonly [string, string, RegExp]> = [
    ['fichier absent, donc contenu vide', '', /vide/],
    ['espaces seulement', '   \n', /vide/],
    ['JSON tronqué', fixture('a-fichier-absent').slice(0, 400), /illisible/],
    ['JSON valide mais pas un objet', '"bonjour"', /pas un objet/],
  ]

  for (const [nom, contenu, attendu] of cas) {
    it(`retourne une erreur lisible : ${nom}`, () => {
      const r = parseResult(contenu)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(attendu)
    })
  }

  it('accepte un rapport sans le moindre résultat', () => {
    const r = parseResult('{"success": false}')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.files).toEqual([])
  })

  it('ignore les champs mal typés au lieu de planter', () => {
    const r = parseResult('{"testResults": [null, {"assertionResults": "oups"}], "numTotalTests": "3"}')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.numTotalTests).toBe(0)
    expect(r.value.files.map((f) => f.status)).toEqual(['unknown', 'unknown'])
    expect(r.value.files[1]?.assertions).toEqual([])
  })
})
