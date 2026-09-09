import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { safeResolve, type ResolvedPath } from './paths.js'
import { applyTestsMove, detectTestsDir, planTestsMove } from './finish.js'

let dir: string
let root: ResolvedPath

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'learnpath-finish-'))
  const resolved = safeResolve(dir, '.', { allowRoot: true })
  if (!resolved.ok) throw new Error(resolved.error)
  root = resolved.value
  await fs.mkdir(path.join(dir, '.learn', 'tests'), { recursive: true })
  await fs.writeFile(path.join(dir, '.learn', 'tests', 'step-1.1.spec.js'), 'a', 'utf8')
  await fs.writeFile(path.join(dir, '.learn', 'tests', 'step-1.2.spec.js'), 'b', 'utf8')
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('detectTestsDir', () => {
  it('ne devine rien quand aucun dossier de tests n\'existe', async () => {
    expect(await detectTestsDir(root)).toBeUndefined()
  })

  it('trouve le dossier quand il n\'y en a qu\'un', async () => {
    await fs.mkdir(path.join(dir, 'tests'))
    expect(await detectTestsDir(root)).toBe('tests')
  })

  it('ne devine rien quand plusieurs candidats existent', async () => {
    await fs.mkdir(path.join(dir, 'tests'))
    await fs.mkdir(path.join(dir, '__tests__'))
    expect(await detectTestsDir(root)).toBeUndefined()
  })

  it('ignore un fichier qui porte le nom d\'un candidat', async () => {
    await fs.writeFile(path.join(dir, 'tests'), '', 'utf8')
    expect(await detectTestsDir(root)).toBeUndefined()
  })
})

describe('planTestsMove', () => {
  it('liste les fichiers à déplacer sans rien écrire', async () => {
    const plan = await planTestsMove(root, 'tests')
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.value.map((m) => m.label)).toEqual([
      path.join('tests', 'step-1.1.spec.js'),
      path.join('tests', 'step-1.2.spec.js'),
    ])
    await expect(fs.stat(path.join(dir, 'tests'))).rejects.toThrow()
  })

  it('refuse d\'écraser un fichier existant, en le nommant', async () => {
    await fs.mkdir(path.join(dir, 'tests'))
    await fs.writeFile(path.join(dir, 'tests', 'step-1.2.spec.js'), 'déjà là', 'utf8')

    const plan = await planTestsMove(root, 'tests')
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.error).toContain('step-1.2.spec.js')
    expect(plan.error).toContain('ne seront pas écrasés')
  })

  it('refuse une destination hors du projet', async () => {
    const plan = await planTestsMove(root, '../ailleurs')
    expect(plan.ok).toBe(false)
  })

  it('refuse un dossier .learn/tests vide', async () => {
    await fs.rm(path.join(dir, '.learn', 'tests'), { recursive: true })
    await fs.mkdir(path.join(dir, '.learn', 'tests'))
    const plan = await planTestsMove(root, 'tests')
    expect(plan.ok).toBe(false)
  })
})

describe('applyTestsMove', () => {
  it('déplace les fichiers et crée le dossier de destination', async () => {
    const plan = await planTestsMove(root, 'src/__tests__')
    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    const moved = await applyTestsMove(plan.value)
    expect(moved.ok).toBe(true)
    expect(await fs.readFile(path.join(dir, 'src', '__tests__', 'step-1.1.spec.js'), 'utf8')).toBe('a')
    expect(await fs.readdir(path.join(dir, '.learn', 'tests'))).toEqual([])
  })
})
