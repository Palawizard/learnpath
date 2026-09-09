import { describe, it, expect } from 'vitest'
import { filterArgs } from './vitest.js'

describe('filtre -t', () => {
  it('ne filtre rien quand aucune étape n\'est demandée', () => {
    expect(filterArgs([])).toEqual([])
  })

  it('échappe le point : « step 1.1 » ne doit pas matcher « step 111 »', () => {
    const args = filterArgs(['1.1'])
    expect(args).toEqual(['-t', 'step 1\\.1'])
    expect(new RegExp(args[1] ?? '').test('step 111')).toBe(false)
    expect(new RegExp(args[1] ?? '').test('step 1.1 — panier vide')).toBe(true)
  })

  it('alterne les étapes pour la régression', () => {
    const args = filterArgs(['1.1', '1.2', '1.3'])
    expect(args[1]).toBe('step 1\\.1|step 1\\.2|step 1\\.3')
    const regex = new RegExp(args[1] ?? '')
    expect(regex.test('step 1.2 — ajout')).toBe(true)
    expect(regex.test('step 1.4 — promo')).toBe(false)
  })
})
