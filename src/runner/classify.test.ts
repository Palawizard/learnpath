import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { loadParcours, type Step } from '../core/parcours.js'
import { parseResult, type RawResult } from './parse.js'
import { classify } from './classify.js'

/** Sorties Vitest réelles, jamais un objet inventé. Voir __fixtures__/README.md. */
function fixture(name: string): RawResult {
  const r = parseResult(readFileSync(`src/runner/__fixtures__/${name}.json`, 'utf8'))
  if (!r.ok) throw new Error(`${name} : ${r.error}`)
  return r.value
}

function etape(id: string): Step {
  const raw: unknown = JSON.parse(readFileSync('examples/exemple-panier.json', 'utf8'))
  const parcours = loadParcours(raw)
  if (!parcours.ok) throw new Error(parcours.error.map((e) => e.message).join('\n'))
  const step = parcours.value.steps.find((s) => s.id === id)
  if (!step) throw new Error(`étape ${id} absente de exemple-panier.json`)
  return step
}

describe('classify — les quatre états', () => {
  it('fichier cible pas encore créé : missing-file, et rien à afficher', () => {
    const c = classify(fixture('a-fichier-absent'), etape('1.1'))
    expect(c.state).toBe('missing-file')
    expect(c.message).toBeUndefined()
  })

  it('fichier présent mais syntaxiquement invalide : parse-error', () => {
    const c = classify(fixture('b-syntaxe-invalide'), etape('1.1'))
    expect(c.state).toBe('parse-error')
    expect(c.message).toContain('invalid JS syntax')
  })

  it('assertion en échec : assertion-failed, avec attendu / reçu', () => {
    const c = classify(fixture('c-assertion-echouee'), etape('1.1'))
    expect(c.state).toBe('assertion-failed')
    expect(c.failures.map((f) => f.fullName)).toEqual([
      'step 1.1 — panier vide a des lignes vides et aucune promo',
    ])
    expect(c.message).toContain('expected [ 1 ] to deeply equal []')
  })

  it('tout passe : pass', () => {
    const raw = fixture('d-tout-passe')
    for (const id of ['1.1', '1.2', '1.3', '1.4', '1.5']) {
      expect(classify(raw, etape(id)).state, `étape ${id}`).toBe('pass')
    }
  })
})

describe('classify — pièges', () => {
  it('(a) et (b) ont les mêmes compteurs et se distinguent quand même', () => {
    const a = fixture('a-fichier-absent')
    const b = fixture('b-syntaxe-invalide')
    expect(a.numTotalTests).toBe(b.numTotalTests)
    expect(classify(a, etape('1.1')).state).not.toBe(classify(b, etape('1.1')).state)
  })

  it('un module introuvable hors expected.files n\'est pas avalé en missing-file', () => {
    const c = classify(fixture('f-module-inattendu'), etape('1.1'))
    expect(c.state).toBe('parse-error')
    expect(c.message).toContain('helpers-inexistants.js')
  })

  it('une étape filtrée dont les tests sont skipped n\'est jamais pass', () => {
    const c = classify(fixture('c-assertion-echouee'), etape('1.3'))
    expect(c.state).not.toBe('pass')
  })

  it('une étape sans aucun résultat remonte une erreur, pas un vert', () => {
    const c = classify({ success: true, numTotalTests: 0, files: [] }, etape('1.1'))
    expect(c.state).toBe('parse-error')
    expect(c.message).toContain('.learn/tests/step-1.1.spec.js')
  })

  it('« step 1.1 » n\'attrape pas « step 1.10 »', () => {
    const raw = fixture('d-tout-passe')
    const dixieme: Step = { ...etape('1.1'), id: '1.10' }
    expect(classify(raw, dixieme).state).not.toBe('pass')
  })
})
