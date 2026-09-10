import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { loadParcours, type Parcours } from './parcours.js'
import { safeResolve, type ResolvedPath } from './paths.js'
import { createState, type ParcoursState } from './state.js'
import { parseResult, type RawResult } from '../runner/parse.js'
import { ok } from './result.js'
import { runCurrentStep, type Execute, type Session } from './progression.js'
import { applyRedo, checkpointStart, checkpointStatus, planRedo, writeBaseRef } from './redo.js'
import { baseRef, isRefSafe, stepRef } from './git.js'

/**
 * Aucune simulation de git : chaque test tourne dans un vrai dépôt temporaire, et les
 * vérifications se font avec de vraies commandes git. Un faux `git` prouverait seulement
 * que le faux fait ce qu'on lui a dit.
 */

const parcours: Parcours = (() => {
  const r = loadParcours(JSON.parse(readFileSync('examples/exemple-panier.json', 'utf8')))
  if (!r.ok) throw new Error(r.error.map((e) => e.message).join('\n'))
  return r.value
})()

function fixture(name: string): RawResult {
  const r = parseResult(readFileSync(`src/runner/__fixtures__/${name}.json`, 'utf8'))
  if (!r.ok) throw new Error(`${name} : ${r.error}`)
  return r.value
}

/** `execute` de test : le vrai runner n'a rien à faire ici, on teste ce qui suit le run. */
function passes(): Execute {
  const raw = fixture('d-tout-passe')
  return () => Promise.resolve(ok(raw))
}

let dir: string
let root: ResolvedPath

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

async function write(relative: string, content: string): Promise<void> {
  const file = path.join(dir, relative)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content, 'utf8')
}

function read(relative: string): string {
  return readFileSync(path.join(dir, relative), 'utf8')
}

async function missing(relative: string): Promise<boolean> {
  try {
    await fs.stat(path.join(dir, relative))
    return false
  } catch {
    return true
  }
}

/** Arborescence complète du projet, `.git/` exclu : chemin → contenu. */
async function tree(base = dir, prefix = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const entry of await fs.readdir(base, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) Object.assign(out, await tree(path.join(base, entry.name), relative))
    else out[relative] = await fs.readFile(path.join(base, entry.name), 'utf8')
  }
  return out
}

function session(currentStepId: string, patch: Partial<ParcoursState> = {}): Session {
  const stateFile = safeResolve(dir, '.learn/state.json')
  if (!stateFile.ok) throw new Error(stateFile.error)
  return {
    parcours,
    root,
    stateFile: stateFile.value,
    cwd: root,
    state: { ...createState(parcours.slug, currentStepId), ...patch },
  }
}

/** Dépôt propre, un commit, `src/autre.js` qui n'appartient à aucune étape du parcours. */
async function repository(withPanier: boolean): Promise<void> {
  git('init', '--initial-branch=main')
  git('config', 'user.email', 'test@learnpath')
  git('config', 'user.name', 'Test')
  git('config', 'core.autocrlf', 'false')
  await write('src/autre.js', 'export const autre = 1\n')
  if (withPanier) await write('src/panier.js', 'v0\n')
  git('add', '-A')
  git('commit', '-m', 'init')
}

/** Import réussi dans un dépôt propre : la référence de départ est posée. */
async function importCheckpoints(): Promise<void> {
  const start = await checkpointStart(root, parcours, true)
  if (start.head === undefined) throw new Error(start.reason ?? 'pas de tête')
  const base = await writeBaseRef(root, parcours.slug, start.head)
  if (!base.ok) throw new Error(base.error)
}

/** Joue une étape jusqu'au vert, avec le contenu donné pour le fichier de l'étape. */
async function validate(stepId: string, content: string): Promise<Session> {
  await write('src/panier.js', content)
  const result = await runCurrentStep(session(stepId), { execute: passes() })
  if (!result.ok) throw new Error(result.error)
  expect(result.value.checkpointError).toBeUndefined()
  return session(result.value.state.currentStepId)
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'learnpath-redo-'))
  const resolved = safeResolve(dir, '.', { allowRoot: true })
  if (!resolved.ok) throw new Error(resolved.error)
  root = resolved.value
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('isRefSafe', () => {
  it('accepte les identifiants d\'étape ordinaires', () => {
    expect(isRefSafe('1.2')).toBe(true)
    expect(isRefSafe('etape-3_b')).toBe(true)
  })

  it('refuse ce que git refuse, et le nom réservé « base »', () => {
    expect(isRefSafe('base')).toBe(false)
    expect(isRefSafe('1..2')).toBe(false)
    expect(isRefSafe('1.')).toBe(false)
    expect(isRefSafe('a.lock')).toBe(false)
    expect(isRefSafe('.cache')).toBe(false)
    expect(isRefSafe('')).toBe(false)
  })
})

describe('un commit par étape validée', () => {
  it('pose une référence par étape, sous refs/learnpath', async () => {
    await repository(true)
    await importCheckpoints()

    await validate('1.1', 'v1\n')
    await validate('1.2', 'v2\n')

    expect(git('rev-parse', '--verify', stepRef('panier', '1.1'))).toMatch(/^[0-9a-f]{40}$/)
    expect(git('show', `${stepRef('panier', '1.1')}:src/panier.js`)).toBe('v1')
    expect(git('show', `${stepRef('panier', '1.2')}:src/panier.js`)).toBe('v2')
    // La chaîne part de la référence de départ, elle ne se greffe pas sur la branche.
    expect(git('rev-parse', `${stepRef('panier', '1.2')}^`)).toBe(
      git('rev-parse', stepRef('panier', '1.1'))
    )
    expect(git('rev-parse', `${stepRef('panier', '1.1')}^`)).toBe(git('rev-parse', baseRef('panier')))
    // Aucun tag : la liste des tags de l'utilisateur reste la sienne.
    expect(git('tag', '--list')).toBe('')
  })

  it('ne commite que les expected.files, et n\'emporte pas le travail en cours ailleurs', async () => {
    await repository(true)
    await importCheckpoints()

    // Du travail en cours qui n'appartient pas à l'étape : modifié et non commité,
    // plus un fichier non suivi.
    await write('src/autre.js', 'brouillon en cours\n')
    await write('notes.txt', 'à moi\n')
    const headBefore = git('rev-parse', 'HEAD')

    await validate('1.1', 'v1\n')

    // Le commit de l'étape porte l'état commité de `src/autre.js`, pas le brouillon.
    expect(git('show', `${stepRef('panier', '1.1')}:src/autre.js`)).toBe('export const autre = 1')
    // Et sur le disque comme dans l'index, rien n'a bougé.
    expect(read('src/autre.js')).toBe('brouillon en cours\n')
    expect(read('notes.txt')).toBe('à moi\n')
    expect(git('rev-parse', 'HEAD')).toBe(headBefore)
    // L'index de l'utilisateur n'a rien reçu : le commit est passé par un index temporaire.
    expect(git('diff', '--cached', '--name-only')).toBe('')
    expect(git('status', '--porcelain')).toContain('M src/autre.js')
    expect(git('rev-list', '--count', 'HEAD')).toBe('1')
  })

  it('ne commite rien quand l\'option est coupée', async () => {
    await repository(true)
    await importCheckpoints()

    await write('src/panier.js', 'v1\n')
    const result = await runCurrentStep(session('1.1'), { execute: passes(), gitCheckpoints: false })

    expect(result.ok).toBe(true)
    expect(() => git('rev-parse', '--verify', stepRef('panier', '1.1'))).toThrow()
  })
})

describe('refaire une étape', () => {
  it('restaure le fichier de l\'étape et rien d\'autre, puis ramène le state', async () => {
    await repository(true)
    await importCheckpoints()

    await validate('1.1', 'v1\n')
    await validate('1.2', 'v2\n')
    await write('src/autre.js', 'brouillon en cours\n')
    await write('notes.txt', 'à moi\n')

    const current = session('1.3')
    const plan = await planRedo(current, '1.2', true)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.value.targets.map((t) => `${t.file}:${t.action}`)).toEqual(['src/panier.js:restore'])

    const applied = await applyRedo(current, plan.value)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return

    // Le fichier de l'étape revient à son contenu d'avant l'étape 1.2, c'est-à-dire celui
    // laissé par 1.1.
    expect(read('src/panier.js')).toBe('v1\n')
    // Le travail en cours ailleurs est intact, commité comme non commité.
    expect(read('src/autre.js')).toBe('brouillon en cours\n')
    expect(read('notes.txt')).toBe('à moi\n')
    expect(applied.value.state.currentStepId).toBe('1.2')
    expect(JSON.parse(read('.learn/state.json')).currentStepId).toBe('1.2')
  })

  it('ne touche à rien d\'autre dans tout le projet', async () => {
    await repository(true)
    await importCheckpoints()
    await validate('1.1', 'v1\n')
    await validate('1.2', 'v2\n')
    await write('src/autre.js', 'brouillon en cours\n')
    await write('notes.txt', 'à moi\n')
    await write('src/.caché', 'discret\n')

    const before = await tree()
    const current = session('1.3')
    const plan = await planRedo(current, '1.2', true)
    if (!plan.ok) throw new Error(plan.error)
    expect((await applyRedo(current, plan.value)).ok).toBe(true)
    const after = await tree()

    const changed = Object.keys({ ...before, ...after }).filter((file) => before[file] !== after[file])
    // Le fichier de l'étape, et la progression sous .learn/. Rien d'autre.
    expect(changed.sort()).toEqual(['.learn/state.json', 'src/panier.js'])
  })

  it('supprime un fichier qui n\'existait pas avant l\'étape', async () => {
    await repository(false)
    await importCheckpoints()
    await validate('1.1', 'v1\n')

    const current = session('1.2')
    const plan = await planRedo(current, '1.1', true)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.value.targets.map((t) => t.action)).toEqual(['delete'])

    expect((await applyRedo(current, plan.value)).ok).toBe(true)
    expect(await missing('src/panier.js')).toBe(true)
  })

  it('garde le contenu remplacé dans une référence de sauvegarde', async () => {
    await repository(true)
    await importCheckpoints()
    await validate('1.1', 'v1\n')

    // Une tentative jamais validée, donc jamais commitée nulle part ailleurs.
    await write('src/panier.js', 'ma tentative\n')
    const current = session('1.2')
    const plan = await planRedo(current, '1.1', true)
    if (!plan.ok) throw new Error(plan.error)
    expect((await applyRedo(current, plan.value)).ok).toBe(true)

    const backups = git('for-each-ref', '--format=%(refname)', 'refs/learnpath-backup/').split('\n')
    expect(backups).toHaveLength(1)
    expect(git('show', `${backups[0]}:src/panier.js`)).toBe('ma tentative')
  })

  it('ne réécrit pas l\'historique : HEAD, la branche et les commits sont inchangés', async () => {
    await repository(true)
    await importCheckpoints()
    const headBefore = git('rev-parse', 'HEAD')
    const logBefore = git('log', '--format=%H %s')

    await validate('1.1', 'v1\n')
    await validate('1.2', 'v2\n')
    const current = session('1.3')
    const plan = await planRedo(current, '1.2', true)
    if (!plan.ok) throw new Error(plan.error)
    expect((await applyRedo(current, plan.value)).ok).toBe(true)

    expect(git('rev-parse', 'HEAD')).toBe(headBefore)
    expect(git('log', '--format=%H %s')).toBe(logBefore)
    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    // Le commit remplacé reste atteignable par le reflog de sa référence.
    expect(git('reflog', stepRef('panier', '1.1'))).not.toBe('')
  })

  it('reprend un parcours terminé : completedAt saute', async () => {
    await repository(true)
    await importCheckpoints()
    await validate('1.1', 'v1\n')

    const finished = session('1.5', { completedAt: new Date().toISOString() })
    const plan = await planRedo(finished, '1.1', true)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    const applied = await applyRedo(finished, plan.value)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.value.state.completedAt).toBeUndefined()
    expect(applied.value.state.currentStepId).toBe('1.1')
  })

  it('refuse une étape qui n\'est pas encore validée', async () => {
    await repository(true)
    await importCheckpoints()
    await validate('1.1', 'v1\n')

    const plan = await planRedo(session('1.2'), '1.2', true)
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.error).toContain("n'est pas encore validée")
  })

  it('refuse quand l\'étape a été validée sans point de restauration', async () => {
    await repository(true)
    await importCheckpoints()
    // 1.1 validée option coupée : sa référence n'existe pas, celle d'avant 1.2 non plus.
    await write('src/panier.js', 'v1\n')
    await runCurrentStep(session('1.1'), { execute: passes(), gitCheckpoints: false })

    const plan = await planRedo(session('1.3'), '1.2', true)
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.error).toContain('point de restauration')
  })
})

describe('quand la fonctionnalité ne peut pas marcher', () => {
  it('projet sans git : indisponible, avec une explication', async () => {
    await write('src/panier.js', 'v0\n')

    const start = await checkpointStart(root, parcours, true)
    expect(start.head).toBeUndefined()
    expect(start.reason).toContain("n'est pas un dépôt git")

    const status = await checkpointStatus(session('1.2'), true)
    expect(status.available).toBe(false)
    const plan = await planRedo(session('1.2'), '1.1', true)
    expect(plan.ok).toBe(false)
  })

  it('arbre sale à l\'import : indisponible, sans rien tenter au clic', async () => {
    await repository(true)
    await write('src/autre.js', 'modification non commitée\n')

    const start = await checkpointStart(root, parcours, true)
    expect(start.head).toBeUndefined()
    expect(start.reason).toContain('propre')

    // Aucune référence de départ n'est posée : la reprise se dit indisponible.
    const status = await checkpointStatus(session('1.2'), true)
    expect(status.available).toBe(false)
    expect(status.reason).toContain('Réimporte')
  })

  it('dépôt sans aucun commit : indisponible', async () => {
    git('init', '--initial-branch=main')
    git('config', 'user.email', 'test@learnpath')
    git('config', 'user.name', 'Test')
    await write('src/panier.js', 'v0\n')

    const start = await checkpointStart(root, parcours, true)
    expect(start.head).toBeUndefined()
    expect(start.reason).toContain('aucun commit')
  })

  it('option coupée : indisponible, et le message nomme l\'option', async () => {
    await repository(true)
    await importCheckpoints()

    const status = await checkpointStatus(session('1.2'), false)
    expect(status.available).toBe(false)
    expect(status.reason).toContain('learnpath.gitCheckpoints')

    const plan = await planRedo(session('1.2'), '1.1', false)
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.error).toContain('learnpath.gitCheckpoints')
  })
})
