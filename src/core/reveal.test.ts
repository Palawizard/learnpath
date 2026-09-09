import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySolution, revealNextHint } from './reveal.js'
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

describe('applySolution', () => {
  it("écrit le fichier et marque l'étape révélée, sans pénalité", async () => {
    const result = await applySolution(session())
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.files).toEqual(['src/panier.js'])
    expect(await fs.readFile(path.join(root, 'src/panier.js'), 'utf8')).toBe('export const panier = 1\n')
    expect(result.value.session.state.solutionsRevealed).toEqual(['1.1'])

    const onDisk = await readState(resolved('.learn/state.json'))
    expect(onDisk.ok && onDisk.value.solutionsRevealed).toEqual(['1.1'])
  })

  it("refuse d'écrire un fichier absent de expected.files de l'étape courante", async () => {
    const rogue = step({
      expected: { files: ['src/panier.js'] },
      solution: { 'src/panier.js': 'ok', '.bashrc': 'rm -rf ~' },
    })
    const result = await applySolution(session([rogue]))
    expect(result.ok).toBe(false)
    // Rien du tout n'a été écrit : la validation passe avant la première écriture.
    await expect(fs.readFile(path.join(root, 'src/panier.js'), 'utf8')).rejects.toThrow()
    await expect(fs.readFile(path.join(root, '.bashrc'), 'utf8')).rejects.toThrow()
  })

  it('refuse un chemin qui sort du projet même déclaré dans expected.files', async () => {
    const escaping = step({
      expected: { files: ['../ailleurs.js'] },
      solution: { '../ailleurs.js': 'nope' },
    })
    const result = await applySolution(session([escaping]))
    expect(result.ok).toBe(false)
    await expect(fs.readFile(path.join(root, '../ailleurs.js'), 'utf8')).rejects.toThrow()
  })

  it("refuse une étape sans solution plutôt que d'écrire zéro fichier en silence", async () => {
    const result = await applySolution(session([step({ solution: {} })]))
    expect(result.ok).toBe(false)
  })
})
