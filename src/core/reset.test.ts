import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { removeParcours, restartParcours } from './reset.js'
import { parseState } from './state.js'

let workspace: string

/** Un parcours importé, une progression avancée, et du code écrit par l'utilisateur. */
beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'learnpath-reset-'))
  await fs.mkdir(path.join(workspace, '.learn/parcours'), { recursive: true })
  await fs.mkdir(path.join(workspace, '.learn/tests'), { recursive: true })
  await fs.mkdir(path.join(workspace, 'src'), { recursive: true })
  await fs.writeFile(
    path.join(workspace, '.learn/parcours/coherent.json'),
    readFileSync('src/core/__fixtures__/solutions-coherentes.json', 'utf8')
  )
  await fs.writeFile(path.join(workspace, '.learn/tests/step-1.1.spec.js'), '// test\n')
  await fs.writeFile(
    path.join(workspace, '.learn/state.json'),
    JSON.stringify({
      version: 1,
      slug: 'coherent',
      currentStepId: '1.2',
      hintsRevealed: { '1.1': 2 },
      solutionsRevealed: ['1.1'],
      startedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
  )
  await fs.writeFile(path.join(workspace, 'src/calc.js'), 'export const mien = 1\n')
})

const exists = async (relative: string): Promise<boolean> => {
  try {
    await fs.stat(path.join(workspace, relative))
    return true
  } catch {
    return false
  }
}

describe('restartParcours', () => {
  it("repart de la première étape, sans indice ni solution retenus", async () => {
    const restarted = await restartParcours(workspace)
    expect(restarted).toEqual({ ok: true, value: '1.1' })

    const state = parseState(await fs.readFile(path.join(workspace, '.learn/state.json'), 'utf8'))
    expect(state.ok).toBe(true)
    if (state.ok) {
      expect(state.value.currentStepId).toBe('1.1')
      expect(state.value.hintsRevealed).toEqual({})
      expect(state.value.solutionsRevealed).toEqual([])
    }
  })

  it('garde les tests, le parcours, et surtout le code de l’utilisateur', async () => {
    await restartParcours(workspace)
    expect(await exists('.learn/tests/step-1.1.spec.js')).toBe(true)
    expect(await exists('.learn/parcours/coherent.json')).toBe(true)
    expect(await fs.readFile(path.join(workspace, 'src/calc.js'), 'utf8')).toBe('export const mien = 1\n')
  })

  it("fonctionne même avec un state.json illisible, puisque c'est justement le cas où on l'appelle", async () => {
    await fs.writeFile(path.join(workspace, '.learn/state.json'), '{ pas du json')
    const restarted = await restartParcours(workspace)
    expect(restarted.ok).toBe(true)
  })

  it('refuse proprement quand aucun parcours n’est importé', async () => {
    await fs.rm(path.join(workspace, '.learn'), { recursive: true, force: true })
    const restarted = await restartParcours(workspace)
    expect(restarted.ok).toBe(false)
    if (!restarted.ok) expect(restarted.error).toContain('Aucun parcours importé')
  })
})

describe('removeParcours', () => {
  it('supprime .learn/ en entier et rien d’autre', async () => {
    const removed = await removeParcours(workspace)
    expect(removed.ok).toBe(true)
    expect(await exists('.learn')).toBe(false)
    expect(await fs.readFile(path.join(workspace, 'src/calc.js'), 'utf8')).toBe('export const mien = 1\n')
  })

  it('est sans effet quand .learn/ n’existe pas', async () => {
    await removeParcours(workspace)
    expect((await removeParcours(workspace)).ok).toBe(true)
  })
})
