import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { removeParcours, restartParcours } from './reset.js'
import { loadSession } from './progression.js'
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
  await fs.writeFile(path.join(workspace, '.learn/vitest.config.mts'), 'export default {}\n')
  await fs.mkdir(path.join(workspace, '.learn/.vite'), { recursive: true })
  await fs.writeFile(path.join(workspace, '.learn/.vite/cache'), 'x\n')
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
  it('garde les parcours générés et supprime tout le reste (D38)', async () => {
    const removed = await removeParcours(workspace)
    expect(removed).toEqual({ ok: true, value: ['.learn/parcours/coherent.json'] })

    expect(await exists('.learn/parcours/coherent.json')).toBe(true)
    expect(await exists('.learn/state.json')).toBe(false)
    expect(await exists('.learn/tests')).toBe(false)
    expect(await exists('.learn/vitest.config.mts')).toBe(false)
    expect(await exists('.learn/.vite')).toBe(false)
  })

  it('laisse le JSON gardé intact, octet pour octet — c’est tout l’objet', async () => {
    const before = await fs.readFile(path.join(workspace, '.learn/parcours/coherent.json'), 'utf8')
    await removeParcours(workspace)
    expect(await fs.readFile(path.join(workspace, '.learn/parcours/coherent.json'), 'utf8')).toBe(before)
  })

  it('ne ressuscite pas la session : le parcours gardé ne se rejoue pas tout seul', async () => {
    await removeParcours(workspace)
    // Sans state, il n'y a plus de session : la vue revient à l'accueil, et le parcours
    // gardé attend un réimport explicite.
    expect((await loadSession(workspace)).ok).toBe(false)
  })

  it('ne touche pas au code de l’utilisateur', async () => {
    await removeParcours(workspace)
    expect(await fs.readFile(path.join(workspace, 'src/calc.js'), 'utf8')).toBe('export const mien = 1\n')
  })

  it('supprime .learn/ en entier quand il n’y a aucun JSON à garder', async () => {
    await fs.rm(path.join(workspace, '.learn/parcours'), { recursive: true, force: true })
    const removed = await removeParcours(workspace)
    expect(removed).toEqual({ ok: true, value: [] })
    expect(await exists('.learn')).toBe(false)
  })

  it('ne garde pas un fichier qui n’est pas un parcours, même dans parcours/', async () => {
    await fs.writeFile(path.join(workspace, '.learn/parcours/notes.txt'), 'note\n')
    await fs.mkdir(path.join(workspace, '.learn/parcours/faux.json'))
    await removeParcours(workspace)
    expect(await exists('.learn/parcours/notes.txt')).toBe(false)
    expect(await exists('.learn/parcours/faux.json')).toBe(false)
    expect(await exists('.learn/parcours/coherent.json')).toBe(true)
  })

  it('refuse de supprimer si parcours/ est illisible au lieu de risquer les JSON', async () => {
    await fs.rm(path.join(workspace, '.learn/parcours'), { recursive: true })
    await fs.writeFile(path.join(workspace, '.learn/parcours'), 'pas un dossier\n')

    const removed = await removeParcours(workspace)

    expect(removed.ok).toBe(false)
    expect(await exists('.learn/state.json')).toBe(true)
    expect(await exists('.learn/tests/step-1.1.spec.js')).toBe(true)
  })

  it('est sans effet quand .learn/ n’existe pas', async () => {
    await fs.rm(path.join(workspace, '.learn'), { recursive: true, force: true })
    expect((await removeParcours(workspace)).ok).toBe(true)
    expect(await exists('.learn')).toBe(false)
  })

  it('est idempotent : rappelé, il garde le même JSON', async () => {
    await removeParcours(workspace)
    expect(await removeParcours(workspace)).toEqual({
      ok: true,
      value: ['.learn/parcours/coherent.json'],
    })
  })
})
