import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  STATE_FORMAT_VERSION,
  advanceTo,
  createState,
  parseState,
  readState,
  revealHint,
  revealSolution,
  writeState,
} from './state.js'
import { safeResolve } from './paths.js'

async function tempFile(): Promise<ReturnType<typeof safeResolve>> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'learnpath-state-'))
  return safeResolve(dir, 'state.json')
}

describe('createState', () => {
  it('démarre sur l\'id de la première étape, pas son index', () => {
    const state = createState('panier', '1.1')
    expect(state.currentStepId).toBe('1.1')
    expect(state.version).toBe(STATE_FORMAT_VERSION)
    expect(state.hintsRevealed).toEqual({})
    expect(state.solutionsRevealed).toEqual([])
  })
})

describe('progression', () => {
  it('avance, compte les indices et n\'inscrit qu\'une fois une solution révélée', () => {
    let state = createState('panier', '1.1')
    state = advanceTo(state, '1.2')
    state = revealHint(state, '1.2')
    state = revealHint(state, '1.2')
    state = revealSolution(state, '1.2')
    state = revealSolution(state, '1.2')

    expect(state.currentStepId).toBe('1.2')
    expect(state.hintsRevealed).toEqual({ '1.2': 2 })
    expect(state.solutionsRevealed).toEqual(['1.2'])
  })
})

describe('parseState', () => {
  it('relit ce que writeState a écrit', async () => {
    const file = await tempFile()
    if (!file.ok) throw new Error(file.error)
    const state = revealHint(createState('panier', '1.1'), '1.1')
    await writeState(file.value, state)

    const read = await readState(file.value)
    expect(read.ok && read.value).toEqual(state)
  })

  it('refuse un JSON cassé sans planter et propose la réinitialisation', () => {
    const result = parseState('{ "version": 1, ')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("ce n'est pas du JSON valide")
    expect(result.error).toContain('Réinitialiser le parcours')
  })

  it('refuse une version de format inconnue', () => {
    const result = parseState(JSON.stringify({ version: 99, slug: 'panier', currentStepId: '1.1' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('version de format inconnue')
    expect(result.error).toContain('Réinitialiser le parcours')
  })

  it('refuse un state amputé de ses champs obligatoires', () => {
    const result = parseState(JSON.stringify({ version: 1, slug: 'panier' }))
    expect(result.ok).toBe(false)
  })

  it('ignore les champs de progression mal typés au lieu de planter', () => {
    const result = parseState(
      JSON.stringify({
        version: 1,
        slug: 'panier',
        currentStepId: '1.2',
        hintsRevealed: { '1.1': 'trois', '1.2': 1 },
        solutionsRevealed: ['1.1', 42],
      })
    )
    expect(result.ok && result.value.hintsRevealed).toEqual({ '1.2': 1 })
    expect(result.ok && result.value.solutionsRevealed).toEqual(['1.1'])
  })

  it('signale l\'absence de fichier autrement qu\'une corruption', async () => {
    const file = await tempFile()
    if (!file.ok) throw new Error(file.error)
    const result = await readState(file.value)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('Aucune progression enregistrée')
  })
})
