import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { planSolution, revealCurrentScaffold, revealCurrentSolution, revealNextHint } from './reveal.js'
import { type ResolvedPath, safeResolve } from './paths.js'
import type { Session } from './progression.js'
import type { Parcours, Step } from './parcours.js'
import { STATE_FORMAT_VERSION, readState } from './state.js'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'learnpath-reveal-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function resolved(relative: string): ResolvedPath {
  const r = safeResolve(root, relative, { allowRoot: true })
  if (!r.ok) throw new Error(r.error)
  return r.value
}

function step(overrides: Partial<Step> = {}): Step {
  return {
    id: '1.1',
    title: 'Créer un panier',
    explanation: '',
    expected: { files: ['src/panier.js'] },
    tests: { file: '.learn/tests/step-1.1.spec.js', grep: 'step 1.1', content: '' },
    hints: ['premier', 'deuxième'],
    solution: { 'src/panier.js': 'export const panier = 1\n' },
    ...overrides,
  }
}

function session(steps: readonly Step[] = [step()]): Session {
  const parcours: Parcours = {
    version: 1,
    slug: 'panier',
    title: 'Panier',
    runner: { kind: 'vitest' },
    steps,
  }
  return {
    parcours,
    root: resolved('.'),
    stateFile: resolved('.learn/state.json'),
    cwd: resolved('.'),
    state: {
      version: STATE_FORMAT_VERSION,
      slug: 'panier',
      currentStepId: steps[0]?.id ?? '1.1',
      hintsRevealed: {},
      solutionsRevealed: [],
      scaffoldsRevealed: [],
      startedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  }
}

describe('revealNextHint', () => {
  it('révèle un indice à la fois et écrit le state', async () => {
    const first = await revealNextHint(session())
    expect(first.ok && first.value.state.hintsRevealed['1.1']).toBe(1)

    const second = await revealNextHint(first.ok ? first.value : session())
    expect(second.ok && second.value.state.hintsRevealed['1.1']).toBe(2)

    const onDisk = await readState(resolved('.learn/state.json'))
    expect(onDisk.ok && onDisk.value.hintsRevealed['1.1']).toBe(2)
  })

  it("refuse d'aller au-delà du dernier indice", async () => {
    const s = session()
    const exhausted = { ...s, state: { ...s.state, hintsRevealed: { '1.1': 2 } } }
    const result = await revealNextHint(exhausted)
    expect(result.ok).toBe(false)
  })

  it("refuse quand l'étape n'a aucun indice", async () => {
    const result = await revealNextHint(session([step({ hints: [] })]))
    expect(result.ok).toBe(false)
  })
})

/** Tout ce qui existe sous `root`, en chemins relatifs, dossiers compris. */
async function tree(dir = root, prefix = ''): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const out: string[] = []
  for (const entry of entries) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    out.push(relative)
    if (entry.isDirectory()) out.push(...(await tree(path.join(dir, entry.name), relative)))
  }
  return out.sort()
}

describe('revealCurrentSolution', () => {
  it("marque l'étape révélée et écrit le state", async () => {
    const result = await revealCurrentSolution(session())
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.state.solutionsRevealed).toEqual(['1.1'])

    const onDisk = await readState(resolved('.learn/state.json'))
    expect(onDisk.ok && onDisk.value.solutionsRevealed).toEqual(['1.1'])
  })

  /**
   * Non-régression du bug qui a motivé D34 : la solution s'affiche, elle ne s'écrit plus.
   * Écrire le fichier faisait perdre la tentative en cours — VSCode ne recharge pas un
   * buffer modifié, la sauvegarde suivante écrasait ce qu'on venait d'écrire.
   */
  it("n'écrit rien en dehors de .learn/", async () => {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.writeFile(path.join(root, 'src/panier.js'), 'ma tentative en cours\n')

    const result = await revealCurrentSolution(session())
    expect(result.ok).toBe(true)

    // Le travail de l'utilisateur est intact, mot pour mot.
    expect(await fs.readFile(path.join(root, 'src/panier.js'), 'utf8')).toBe(
      'ma tentative en cours\n'
    )
    // Et rien d'autre n'est apparu ailleurs que dans .learn/.
    expect(await tree()).toEqual(['.learn', '.learn/state.json', 'src', 'src/panier.js'])
  })

  it("n'écrit pas non plus le fichier quand il n'existait pas", async () => {
    const result = await revealCurrentSolution(session())
    expect(result.ok).toBe(true)
    await expect(fs.readFile(path.join(root, 'src/panier.js'), 'utf8')).rejects.toThrow()
  })

  it("refuse une étape sans solution plutôt que de la marquer révélée en silence", async () => {
    const result = await revealCurrentSolution(session([step({ solution: {} })]))
    expect(result.ok).toBe(false)
  })
})

/**
 * `planSolution` ne sert plus qu'à `verifyAllGreen`, contre son bac à sable. Ses deux
 * garde-fous restent testés là : c'est le dernier chemin qui écrit une solution.
 */
describe('revealCurrentScaffold', () => {
  it("marque le squelette affiché, écrit le state et ne touche à aucun fichier du projet", async () => {
    const s = session([step({ scaffold: { 'src/panier.js': '// TODO\n' } })])
    const r = await revealCurrentScaffold(s)
    expect(r.ok && r.value.state.scaffoldsRevealed).toEqual(['1.1'])
    const onDisk = await readState(resolved('.learn/state.json'))
    expect(onDisk.ok && onDisk.value.scaffoldsRevealed).toEqual(['1.1'])
    await expect(fs.stat(path.join(root, 'src'))).rejects.toThrow()
  })

  it("refuse une étape sans squelette", async () => {
    const r = await revealCurrentScaffold(session())
    expect(r.ok).toBe(false)
  })
})

describe('planSolution', () => {
  it("refuse un fichier absent de expected.files de l'étape", () => {
    const rogue = step({
      expected: { files: ['src/panier.js'] },
      solution: { 'src/panier.js': 'ok', '.bashrc': 'rm -rf ~' },
    })
    expect(planSolution(root, rogue).ok).toBe(false)
  })

  it('refuse un chemin qui sort du projet même déclaré dans expected.files', () => {
    const escaping = step({
      expected: { files: ['../ailleurs.js'] },
      solution: { '../ailleurs.js': 'nope' },
    })
    expect(planSolution(root, escaping).ok).toBe(false)
  })

  it("refuse une étape sans solution plutôt que de planifier zéro écriture", () => {
    expect(planSolution(root, step({ solution: {} })).ok).toBe(false)
  })
})
