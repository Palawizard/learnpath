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
    scaffoldsRevealed: [],
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
      { id: '1.1', title: 'Titre 1.1', hints: 0, solution: false, scaffold: false },
      { id: '1.2', title: 'Titre 1.2', hints: 2, solution: false, scaffold: false },
      { id: '1.3', title: 'Titre 1.3', hints: 0, solution: true, scaffold: false },
      { id: '1.4', title: 'Titre 1.4', hints: 0, solution: false, scaffold: false },
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

  it('marque la solution révélée et en porte le contenu, fichier par fichier', () => {
    const model = buildViewModel(parcours, state({ solutionsRevealed: ['1.2'] }))
    expect(model?.solutionRevealed).toBe(true)
    // Le fichier existait déjà à l'étape 1.1 : la solution porte aussi ce que l'étape change.
    expect(model?.solution).toEqual([
      { file: 'src/panier.js', content: '// solution', diff: [{ kind: 'same', text: '// solution' }] },
    ])
  })

  it('ne pousse pas la solution tant qu\'elle n\'est pas révélée', () => {
    expect(buildViewModel(parcours, state())?.solution).toEqual([])
  })

  it('porte un bloc par fichier quand une étape en touche plusieurs', () => {
    const multi: Parcours = {
      ...parcours,
      steps: [
        step('1.2', {
          expected: { files: ['src/panier.js', 'src/total.js'] },
          solution: { 'src/panier.js': '// panier', 'src/total.js': '// total' },
        }),
      ],
    }
    const model = buildViewModel(multi, state({ solutionsRevealed: ['1.2'] }))
    expect(model?.solution).toEqual([
      { file: 'src/panier.js', content: '// panier' },
      { file: 'src/total.js', content: '// total' },
    ])
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

  it('collect-error est discret et porte son message', () => {
    const model = buildViewModel(
      parcours,
      state(),
      outcome({
        result: { state: 'collect-error', message: "SyntaxError: Unexpected token '}'", failures: [] },
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

describe('relecture d\'une étape passée', () => {
  const redo = { stepId: '1.1', files: ['src/panier.js'], available: true }

  it('affiche l\'étape relue, en lecture seule, sans la zone d\'état du dernier run', () => {
    const model = buildViewModel(parcours, state({ currentStepId: '1.3' }), outcome(), true, {
      stepId: '1.1',
      redo,
    })

    expect(model?.stepId).toBe('1.1')
    expect(model?.readOnly).toBe(true)
    expect(model?.position).toBe(1)
    // La barre de progression continue de montrer où en est le parcours.
    expect(model?.currentPosition).toBe(3)
    expect(model?.status.kind).toBe('none')
    expect(model?.running).toBe(false)
    expect(model?.regressions).toEqual([])
    // Aucun indice à révéler depuis une étape passée.
    expect(model?.hintsRemaining).toBe(0)
    expect(model?.review?.redo).toEqual(redo)
  })

  it('ne navigue qu\'entre les étapes validées', () => {
    const at = (id: string) =>
      buildViewModel(parcours, state({ currentStepId: '1.3' }), undefined, false, { stepId: id, redo })

    expect(at('1.1')?.review?.previousStepId).toBeUndefined()
    expect(at('1.1')?.review?.nextStepId).toBe('1.2')
    // 1.3 est l'étape courante, pas une étape validée : elle n'est pas « suivante ».
    expect(at('1.2')?.review?.previousStepId).toBe('1.1')
    expect(at('1.2')?.review?.nextStepId).toBeUndefined()
  })

  it('refuse de relire une étape non validée : on retombe sur l\'étape courante', () => {
    const model = buildViewModel(parcours, state({ currentStepId: '1.2' }), undefined, false, {
      stepId: '1.3',
      redo,
    })

    expect(model?.stepId).toBe('1.2')
    expect(model?.readOnly).toBe(false)
    expect(model?.review).toBeUndefined()
  })

  it('propose l\'entrée en relecture dès la première étape validée, jamais avant', () => {
    expect(buildViewModel(parcours, state({ currentStepId: '1.1' }))?.reviewEntry).toBeUndefined()
    expect(buildViewModel(parcours, state({ currentStepId: '1.3' }))?.reviewEntry).toBe('1.2')
    // Parcours terminé : toutes les étapes sont relisables.
    expect(
      buildViewModel(parcours, state({ currentStepId: '1.4', completedAt: '2026-01-02T00:00:00.000Z' }))
        ?.reviewEntry
    ).toBe('1.4')
  })

  it('un parcours terminé relu montre l\'étape, pas le récapitulatif', () => {
    const model = buildViewModel(
      parcours,
      state({ currentStepId: '1.4', completedAt: '2026-01-02T00:00:00.000Z' }),
      undefined,
      false,
      { stepId: '1.4', redo }
    )

    expect(model?.finished).toBe(false)
    expect(model?.recap).toEqual([])
    expect(model?.readOnly).toBe(true)
  })
})

describe('buildViewModel — aides à l’apprentissage (D40 à D42)', () => {
  const guided: Parcours = {
    ...parcours,
    intro: 'On construit un panier.',
    scope: { covered: ['le panier'], notCovered: ['la page'] },
    steps: [
      step('1.1', { solution: { 'src/panier.js': 'a\n' } }),
      step('1.2', {
        examples: [{ title: 'Un exemple', code: 'const x = 1' }],
        tests: { file: '.learn/tests/step-1.2.spec.js', grep: 'step 1.2', content: 'le test' },
        scaffold: { 'src/panier.js': 'a\n// TODO\n' },
        solution: { 'src/panier.js': 'a\nb\n' },
      }),
      step('1.3', { expected: { files: ['src/neuf.js'] }, solution: { 'src/neuf.js': 'n\n' } }),
    ],
  }

  it('porte l’intro, le périmètre, les exemples et le test de l’étape', () => {
    const model = buildViewModel(guided, state())
    expect(model?.intro).toBe('On construit un panier.')
    expect(model?.scope?.notCovered).toEqual(['la page'])
    expect(model?.examples).toEqual([{ title: 'Un exemple', code: 'const x = 1' }])
    expect(model?.test).toEqual({ file: '.learn/tests/step-1.2.spec.js', content: 'le test' })
  })

  it('ne pousse le squelette qu’une fois demandé, avec ce qu’il change', () => {
    expect(buildViewModel(guided, state())?.scaffoldAvailable).toBe(true)
    expect(buildViewModel(guided, state())?.scaffold).toEqual([])
    const model = buildViewModel(guided, state({ scaffoldsRevealed: ['1.2'] }))
    expect(model?.scaffoldRevealed).toBe(true)
    expect(model?.scaffold[0]?.diff?.map((line) => line.kind)).toEqual(['same', 'add'])
  })

  it('la solution d’un fichier modifié porte le diff, celle d’un fichier neuf non', () => {
    const modified = buildViewModel(guided, state({ solutionsRevealed: ['1.2'] }))
    expect(modified?.solution[0]?.diff).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'add', text: 'b' },
    ])
    const created = buildViewModel(guided, state({ currentStepId: '1.3', solutionsRevealed: ['1.3'] }))
    expect(created?.solution[0]?.diff).toBeUndefined()
  })

  it('signale deux solutions affichées de suite, pas une seule', () => {
    expect(buildViewModel(guided, state({ solutionsRevealed: ['1.2'] }))?.pacingNotice).toBe(false)
    expect(buildViewModel(guided, state({ solutionsRevealed: ['1.1', '1.2'] }))?.pacingNotice).toBe(true)
  })

  it('note le squelette dans le récapitulatif', () => {
    const model = buildViewModel(
      guided,
      state({ currentStepId: '1.3', completedAt: '2026-01-02T00:00:00.000Z', scaffoldsRevealed: ['1.2'] })
    )
    expect(model?.recap.map((r) => r.scaffold)).toEqual([false, true, false])
  })
})
