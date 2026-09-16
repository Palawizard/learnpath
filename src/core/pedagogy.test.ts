import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadParcours, type Parcours, type Step } from './parcours.js'
import { checkPedagogy, contentBefore, MAX_STEP_LINES, stepSize } from './pedagogy.js'

function step(id: string, solution: string, overrides: Partial<Step> = {}): Step {
  return {
    id,
    title: `Étape ${id}`,
    explanation: 'Pourquoi.',
    examples: [{ title: 'Une boucle', code: 'for (const fruit of fruits) {\n  console.log(fruit)\n}' }],
    expected: { files: ['src/a.js'] },
    tests: { file: `.learn/tests/step-${id}.spec.js`, grep: `step ${id}`, content: 'x' },
    solution: { 'src/a.js': solution },
    ...overrides,
  }
}

function parcours(steps: Step[], overrides: Partial<Parcours> = {}): Parcours {
  return {
    version: 1,
    slug: 'a',
    title: 'A',
    scope: { covered: ['tout'], notCovered: [] },
    runner: { kind: 'vitest' },
    steps,
    ...overrides,
  }
}

const lines = (n: number, prefix = 'const v'): string =>
  Array.from({ length: n }, (_, i) => `${prefix}${i} = ${i}`).join('\n') + '\n'

function problems(p: Parcours): string {
  const r = checkPedagogy(p)
  return r.ok ? '' : r.error
}

describe('checkPedagogy', () => {
  it('accepte les deux parcours d’exemple livrés', () => {
    for (const file of ['examples/exemple-panier.json', 'examples/exemple-panier-python.json']) {
      const loaded = loadParcours(JSON.parse(readFileSync(file, 'utf8')))
      if (!loaded.ok) throw new Error(loaded.error.map((e) => e.message).join('\n'))
      expect(problems(loaded.value)).toBe('')
    }
  })

  it('refuse un parcours sans périmètre annoncé', () => {
    const { scope: _scope, ...sans } = parcours([step('1.1', lines(3))])
    expect(problems(sans)).toContain('« scope » est absent')
  })

  it('refuse une étape sans exemple, en la nommant', () => {
    expect(problems(parcours([step('1.1', lines(3), { examples: [] })]))).toContain('Étape 1.1 : aucun exemple')
  })

  it('mesure l’étape par ce qu’elle ajoute, pas par la taille du fichier', () => {
    const first = lines(15)
    const second = first + lines(10, 'const w')
    const p = parcours([step('1.1', first), step('1.2', second)])
    expect(stepSize(p, 1)).toBe(10)
    expect(problems(p)).toBe('')
  })

  it(`refuse une étape qui demande plus de ${MAX_STEP_LINES} lignes`, () => {
    const p = parcours([step('1.1', lines(3)), step('1.2', lines(3) + lines(MAX_STEP_LINES + 1, 'let w'))])
    expect(problems(p)).toContain(`Étape 1.2 : la solution demande ${MAX_STEP_LINES + 1} lignes`)
    expect(problems(p)).not.toContain('Étape 1.1')
  })

  it('refuse un exemple qui recopie la solution de l’étape', () => {
    const solution = [
      'export function total(lines) {',
      '  let sum = 0',
      '  for (const line of lines) {',
      '    sum += line.price * line.qty',
      '  }',
      '  return Math.round(sum * 100) / 100',
      '}',
    ].join('\n')
    const p = parcours([
      step('1.1', solution, { examples: [{ title: 'Le total', code: solution }] }),
    ])
    expect(problems(p)).toContain('l’exemple « Le total » reprend la solution')
  })

  it('accepte un exemple qui partage seulement la syntaxe', () => {
    const p = parcours([
      step('1.1', 'export function total(lines) {\n  return lines.reduce((s, l) => s + l.price, 0)\n}\n', {
        examples: [
          {
            title: 'reduce sur des notes',
            code: 'const notes = [12, 15, 9]\nconst somme = notes.reduce((acc, note) => acc + note, 0)\nconsole.log(somme)',
          },
        ],
      }),
    ])
    expect(problems(p)).toBe('')
  })
})

describe('contentBefore', () => {
  it('prend la dernière solution antérieure qui écrit le fichier', () => {
    const p = parcours([
      step('1.1', 'v1'),
      step('1.2', 'b', { expected: { files: ['src/b.js'] }, solution: { 'src/b.js': 'b' } }),
      step('1.3', 'v3'),
    ])
    expect(contentBefore(p, 2, 'src/a.js')).toBe('v1')
    expect(contentBefore(p, 0, 'src/a.js')).toBe('')
  })
})
