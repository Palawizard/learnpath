import { describe, expect, it } from 'vitest'
import { buildViewModel } from './viewmodel.js'
import type { Parcours, Step } from './parcours.js'
import type { Outcome } from './progression.js'
import type { ParcoursState } from './state.js'
import { STATE_FORMAT_VERSION } from './state.js'

function step(id: string, overrides: Partial<Step> = {}): Step {
  return {
    id,
    title: `Titre ${id}`,
    explanation: `Explication ${id}`,
    expected: { files: ['src/panier.js'], contract: `contrat ${id}`, acceptance: [`critère ${id}`] },
    tests: { file: `.learn/tests/step-${id}.spec.js`, grep: `step ${id}`, content: '' },
    hints: ['premier indice', 'deuxième indice'],
    solution: { 'src/panier.js': '// solution' },
    ...overrides,
  }
}

const parcours: Parcours = {
  version: 1,
  slug: 'panier',
  title: 'Panier',
  runner: { kind: 'vitest' },
  steps: [step('1.1'), step('1.2'), step('1.3'), step('1.4')],
}

function state(overrides: Partial<ParcoursState> = {}): ParcoursState {
  return {
    version: STATE_FORMAT_VERSION,
    slug: 'panier',
    currentStepId: '1.2',
    hintsRevealed: {},
    solutionsRevealed: [],
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function outcome(overrides: Partial<Outcome> = {}): Outcome {
  const current = parcours.steps[1] as Step
  return {
    step: current,
    result: { state: 'pass', failures: [] },
    regressions: [],
    state: state(),
    advanced: false,
    finished: false,
    summary: '',
    ...overrides,
  }
}

describe('buildViewModel — position et progression', () => {
  it('numérote à partir de 1 et compte les étapes acquises', () => {
    const model = buildViewModel(parcours, state({ currentStepId: '1.2' }))
    expect(model?.position).toBe(2)
    expect(model?.total).toBe(4)
    // Une seule étape franchie sur quatre : la barre n'est pas encore à la moitié.
    expect(model?.percent).toBe(25)
  })

  it('affiche 100 % et le récapitulatif quand le parcours est terminé', () => {
    const model = buildViewModel(
      parcours,
      state({
        currentStepId: '1.4',
        completedAt: '2026-01-02T00:00:00.000Z',
        hintsRevealed: { '1.2': 2 },
        solutionsRevealed: ['1.3'],
      })
    )
    expect(model?.percent).toBe(100)
    expect(model?.finished).toBe(true)
    expect(model?.recap).toEqual([
      { id: '1.1', title: 'Titre 1.1', hints: 0, solution: false },
      { id: '1.2', title: 'Titre 1.2', hints: 2, solution: false },
      { id: '1.3', title: 'Titre 1.3', hints: 0, solution: true },
      { id: '1.4', title: 'Titre 1.4', hints: 0, solution: false },
    ])
  })

  it('ne rend rien quand le state pointe une étape absente du parcours', () => {
    expect(buildViewModel(parcours, state({ currentStepId: '9.9' }))).toBeUndefined()
  })

  it('ne montre pas de récapitulatif tant que le parcours est en cours', () => {
    expect(buildViewModel(parcours, state())?.recap).toEqual([])
  })
})

describe('buildViewModel — indices', () => {
  it("ne révèle que les n premiers indices, dans l'ordre du parcours", () => {
    const model = buildViewModel(parcours, state({ hintsRevealed: { '1.2': 1 } }))
    expect(model?.hints).toEqual(['premier indice'])
    expect(model?.hintsRemaining).toBe(1)
  })

  it("n'en révèle aucun par défaut", () => {
    const model = buildViewModel(parcours, state())
    expect(model?.hints).toEqual([])
    expect(model?.hintsRemaining).toBe(2)
  })

  it('ne mélange pas les indices des autres étapes', () => {
    const model = buildViewModel(parcours, state({ hintsRevealed: { '1.1': 2 } }))
    expect(model?.hints).toEqual([])
  })

  it('marque la solution révélée', () => {
    expect(buildViewModel(parcours, state({ solutionsRevealed: ['1.2'] }))?.solutionRevealed).toBe(true)
  })
})

describe('buildViewModel — les quatre états du dernier run', () => {
  it('sans run, la zone d\'état est vide', () => {
    expect(buildViewModel(parcours, state())?.status).toEqual({
      kind: 'none',
      summary: '',
      advanced: false,
    })
  })

  it('missing-file ne produit rien du tout', () => {
    const model = buildViewModel(
      parcours,
      state(),
      outcome({ result: { state: 'missing-file', failures: [] }, summary: '' })
    )
    expect(model?.status.kind).toBe('none')
    expect(model?.status.detail).toBeUndefined()
  })

  it('parse-error est discret et porte son message', () => {
    const model = buildViewModel(
      parcours,
      state(),
      outcome({
        result: { state: 'parse-error', message: "SyntaxError: Unexpected token '}'", failures: [] },
        summary: "Le fichier n'est pas encore valide.",
      })
    )
    expect(model?.status.kind).toBe('progress')
    expect(model?.status.detail).toBe("SyntaxError: Unexpected token '}'")
    expect(model?.status.testName).toBeUndefined()
  })

  it("assertion-failed porte le nom du test et l'assertion sans sa pile d'appels", () => {
    const message =
      'AssertionError: expected [ 1 ] to deeply equal []\n' +
      '    at /projet/.learn/tests/step-1.2.spec.js:7:22\n' +
      '    at file:///projet/node_modules/@vitest/runner/dist/chunk.js:302:11'
    const model = buildViewModel(
      parcours,
      state(),
      outcome({
        result: {
          state: 'assertion-failed',
          message,
          failures: [
            { fullName: 'step 1.2 — ajout ajoute une ligne', status: 'failed', failureMessages: [message] },
          ],
        },
        summary: 'Test en échec : step 1.2 — ajout ajoute une ligne',
      })
    )
    expect(model?.status.kind).toBe('failed')
    expect(model?.status.testName).toBe('step 1.2 — ajout ajoute une ligne')
    expect(model?.status.detail).toBe('AssertionError: expected [ 1 ] to deeply equal []')
  })

  it('pass signale la transition seulement quand on a réellement avancé', () => {
    const passed = buildViewModel(parcours, state(), outcome({ summary: 'Étape 1.2 validée.' }))
    expect(passed?.status).toEqual({ kind: 'passed', summary: 'Étape 1.2 validée.', advanced: false })

    const advanced = buildViewModel(
      parcours,
      state({ currentStepId: '1.3' }),
      outcome({ advanced: true, summary: 'Étape 1.2 validée. Étape suivante : 1.3 — Titre 1.3.' })
    )
    expect(advanced?.status.advanced).toBe(true)
    // L'étape affichée est la nouvelle, la zone d'état parle encore de la précédente.
    expect(advanced?.stepId).toBe('1.3')
  })
})

describe('buildViewModel — régression', () => {
  it("sort la régression du statut : l'étape courante reste validée", () => {
    const previous = parcours.steps[0] as Step
    const model = buildViewModel(
      parcours,
      state(),
      outcome({
        summary: "Étape 1.2 validée. En attente : l'étape 1.1 ne passe plus depuis ta dernière modification.",
        regressions: [
          {
            step: previous,
            result: {
              state: 'assertion-failed',
              message: 'AssertionError: expected 3 to be 2\n    at /projet/x.js:1:1',
              failures: [
                { fullName: 'step 1.1 — panier vide', status: 'failed', failureMessages: ['AssertionError: expected 3 to be 2'] },
              ],
            },
          },
        ],
      })
    )

    expect(model?.status.kind).toBe('passed')
    expect(model?.regressions).toEqual([
      {
        stepId: '1.1',
        stepTitle: 'Titre 1.1',
        testFile: '.learn/tests/step-1.1.spec.js',
        testName: 'step 1.1 — panier vide',
        detail: 'AssertionError: expected 3 to be 2',
        explained: 'Obtenu : 3\nAttendu : 2',
      },
    ])
  })
})
