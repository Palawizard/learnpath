import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { loadParcours, type Parcours } from './parcours.js'
import { safeResolve, type ResolvedPath } from './paths.js'
import { createState, parseState, type ParcoursState } from './state.js'
import { parseResult, type RawResult } from '../runner/parse.js'
import { ok, err } from './result.js'
import {
  RunLoop,
  isWatched,
  loadSession,
  readImportedParcours,
  runCurrentStep,
  type Execute,
  type Session,
} from './progression.js'

function fixture(name: string): RawResult {
  const r = parseResult(readFileSync(`src/runner/__fixtures__/${name}.json`, 'utf8'))
  if (!r.ok) throw new Error(`${name} : ${r.error}`)
  return r.value
}

/**
 * Sorties réelles uniquement : pour obtenir « l'étape courante passe mais une précédente
 * ne passe plus », on prend le fichier de l'étape 1.1 dans la fixture où son assertion
 * échoue et les autres dans celle où tout passe. Aucun résultat n'est écrit à la main.
 */
function withStepFrom(base: RawResult, other: RawResult, testFile: string): RawResult {
  const replacement = other.files.find((f) => f.name.replace(/\\/g, '/').endsWith(testFile))
  if (replacement === undefined) throw new Error(`fichier absent de la fixture : ${testFile}`)
  return {
    ...base,
    files: base.files.map((f) =>
      f.name.replace(/\\/g, '/').endsWith(testFile) ? replacement : f
    ),
  }
}

const parcours: Parcours = (() => {
  const r = loadParcours(JSON.parse(readFileSync('examples/exemple-panier.json', 'utf8')))
  if (!r.ok) throw new Error(r.error.map((e) => e.message).join('\n'))
  return r.value
})()

let root: ResolvedPath
let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'learnpath-progression-'))
  const resolved = safeResolve(dir, '.', { allowRoot: true })
  if (!resolved.ok) throw new Error(resolved.error)
  root = resolved.value
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

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

/** `execute` de test : retourne la fixture demandée et note les ids reçus. */
function executes(raw: RawResult): { execute: Execute; calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    execute: (_root, stepIds) => {
      calls.push([...stepIds])
      return Promise.resolve(ok(raw))
    },
  }
}

async function savedState(): Promise<ParcoursState> {
  const raw = await fs.readFile(path.join(dir, '.learn/state.json'), 'utf8')
  const parsed = parseState(raw)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.value
}

describe('loadSession — plusieurs parcours dans .learn/parcours/ (D44)', () => {
  async function write(relative: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(path.join(dir, relative)), { recursive: true })
    await fs.writeFile(path.join(dir, relative), content, 'utf8')
  }
  const withSlug = (slug: string): string => JSON.stringify({ ...parcours, slug, title: `Parcours ${slug}` })

  it('charge le parcours que state.json désigne, pas le premier fichier du dossier', async () => {
    await write('.learn/parcours/1-donnees.json', withSlug('1-donnees'))
    await write('.learn/parcours/2-ecrans.json', withSlug('2-ecrans'))
    await write('.learn/state.json', JSON.stringify(createState('2-ecrans', '1.1')))

    const session = await loadSession(dir)
    if (!session.ok) throw new Error(session.error)
    expect(session.value.parcours.slug).toBe('2-ecrans')
  })

  it('sans state, retombe sur le premier par ordre alphabétique', async () => {
    await write('.learn/parcours/2-ecrans.json', withSlug('2-ecrans'))
    await write('.learn/parcours/1-donnees.json', withSlug('1-donnees'))
    const loaded = await readImportedParcours(dir)
    expect(loaded.ok && loaded.value.slug).toBe('1-donnees')
  })
})

describe('isWatched', () => {
  it('accepte un fichier de expected.files de l\'étape courante', () => {
    expect(isWatched(session('1.1'), path.join(dir, 'src', 'panier.js'))).toBe(true)
  })

  it('accepte le même fichier écrit avec des séparateurs et un « ./ » différents', () => {
    expect(isWatched(session('1.1'), path.join(dir, '.', 'src', '..', 'src', 'panier.js'))).toBe(true)
  })

  it('ignore une sauvegarde hors de expected.files', () => {
    const s = session('1.1')
    expect(isWatched(s, path.join(dir, 'src', 'autre.js'))).toBe(false)
    expect(isWatched(s, path.join(dir, 'README.md'))).toBe(false)
    expect(isWatched(s, path.join(dir, '.learn', 'tests', 'step-1.1.spec.js'))).toBe(false)
  })

  it('ignore un fichier du même nom hors du projet', () => {
    expect(isWatched(session('1.1'), path.join(os.tmpdir(), 'ailleurs', 'src', 'panier.js'))).toBe(false)
  })

  it('n\'écoute plus rien une fois le parcours terminé', () => {
    const s = session('1.5', { completedAt: new Date().toISOString() })
    expect(isWatched(s, path.join(dir, 'src', 'panier.js'))).toBe(false)
  })
})

describe('runCurrentStep', () => {
  it("un run annulé n'écrit pas le state", async () => {
    const { execute } = executes(fixture('d-tout-passe'))
    const controller = new AbortController()
    controller.abort()

    const r = await runCurrentStep(session('1.1'), { execute, signal: controller.signal })

    expect(r.ok).toBe(true)
    // Rien sur le disque : son remplaçant parlera, et une reprise d'étape a pu réécrire le
    // state pendant que celui-ci tournait (D36).
    await expect(fs.readFile(path.join(dir, '.learn/state.json'), 'utf8')).rejects.toThrow()
  })

  it('lance l\'étape courante et toutes les précédentes', async () => {
    const { execute, calls } = executes(fixture('d-tout-passe'))
    await runCurrentStep(session('1.3'), { execute })
    expect(calls).toEqual([['1.1', '1.2', '1.3']])
  })

  it('au vert : avance à l\'étape suivante et écrit le state', async () => {
    const { execute } = executes(fixture('d-tout-passe'))
    const r = await runCurrentStep(session('1.1'), { execute })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.result.state).toBe('pass')
    expect(r.value.advanced).toBe(true)
    expect(r.value.finished).toBe(false)
    expect(r.value.state.currentStepId).toBe('1.2')
    expect(r.value.summary).toContain('Étape 1.1 validée')
    expect((await savedState()).currentStepId).toBe('1.2')
  })

  it('au rouge : n\'avance pas et n\'écrit aucun state', async () => {
    const { execute } = executes(fixture('c-assertion-echouee'))
    const r = await runCurrentStep(session('1.1'), { execute })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.result.state).toBe('assertion-failed')
    expect(r.value.advanced).toBe(false)
    expect(r.value.state.currentStepId).toBe('1.1')
    await expect(savedState()).rejects.toThrow()
  })

  it('fichier pas encore créé : rien à afficher, on n\'avance pas', async () => {
    const { execute } = executes(fixture('a-fichier-absent'))
    const r = await runCurrentStep(session('1.1'), { execute })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.result.state).toBe('missing-file')
    expect(r.value.summary).toBe('')
    expect(r.value.advanced).toBe(false)
  })

  it('régression : l\'étape courante est validée, la progression est en pause', async () => {
    const raw = withStepFrom(
      fixture('d-tout-passe'),
      fixture('c-assertion-echouee'),
      '.learn/tests/step-1.1.spec.js'
    )
    const { execute } = executes(raw)
    const r = await runCurrentStep(session('1.2'), { execute })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    // L'étape courante passe : ce n'est surtout pas un échec de l'étape 1.2.
    expect(r.value.result.state).toBe('pass')
    expect(r.value.regressions.map((x) => x.step.id)).toEqual(['1.1'])
    expect(r.value.regressions[0]?.result.state).toBe('assertion-failed')
    expect(r.value.advanced).toBe(false)
    expect(r.value.state.currentStepId).toBe('1.2')
    expect(r.value.summary).toBe(
      "Étape 1.2 validée. En attente : l'étape 1.1 ne passe plus depuis ta dernière modification."
    )
    await expect(savedState()).rejects.toThrow()
  })

  it('autoAdvance à false : l\'étape est validée mais le state ne bouge pas', async () => {
    const { execute } = executes(fixture('d-tout-passe'))
    const r = await runCurrentStep(session('1.1'), { execute, autoAdvance: false })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.result.state).toBe('pass')
    expect(r.value.advanced).toBe(false)
    expect(r.value.state.currentStepId).toBe('1.1')
    expect(r.value.summary).toContain('Passe à l\'étape 1.2 quand tu veux')
    await expect(savedState()).rejects.toThrow()
  })

  it('dernière étape franchie : le parcours est marqué terminé', async () => {
    const { execute } = executes(fixture('d-tout-passe'))
    const r = await runCurrentStep(session('1.5'), { execute })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.finished).toBe(true)
    expect(r.value.advanced).toBe(false)
    expect(r.value.state.currentStepId).toBe('1.5')
    expect(r.value.state.completedAt).toBeTypeOf('string')
    expect((await savedState()).completedAt).toBeTypeOf('string')
    expect(r.value.summary).toBe('Parcours terminé : les 5 étapes passent.')
  })

  it('un parcours terminé ne relance plus rien', async () => {
    const { execute, calls } = executes(fixture('d-tout-passe'))
    const r = await runCurrentStep(session('1.5', { completedAt: '2026-01-01T00:00:00.000Z' }), { execute })

    expect(r.ok).toBe(false)
    expect(calls).toEqual([])
  })

  it('remonte l\'erreur du runner sans toucher au state', async () => {
    const r = await runCurrentStep(session('1.1'), {
      execute: () => Promise.resolve(err('Le lancement des tests a été annulé.')),
    })
    expect(r).toEqual({ ok: false, error: 'Le lancement des tests a été annulé.' })
  })

  it('refuse une étape courante absente du parcours', async () => {
    const { execute } = executes(fixture('d-tout-passe'))
    const r = await runCurrentStep(session('9.9'), { execute })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('« 9.9 »')
  })
})

describe('RunLoop', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('ne lance rien avant la fin du debounce, et une seule fois pour trois sauvegardes', async () => {
    const execute = vi.fn(() => Promise.resolve())
    const loop = new RunLoop({ debounceMs: () => 500, execute })

    loop.schedule()
    loop.schedule()
    await vi.advanceTimersByTimeAsync(400)
    loop.schedule()
    await vi.advanceTimersByTimeAsync(400)
    expect(execute).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(200)
    expect(execute).toHaveBeenCalledTimes(1)
    loop.dispose()
  })

  it('une sauvegarde pendant un run annule le run en cours et en relance un après lui', async () => {
    const signals: AbortSignal[] = []
    let releaseFirst: (() => void) | undefined
    let concurrent = 0
    let maxConcurrent = 0

    const loop = new RunLoop({
      debounceMs: () => 500,
      execute: (signal) => {
        signals.push(signal)
        concurrent += 1
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        if (signals.length === 1) {
          return new Promise<void>((resolve) => {
            releaseFirst = () => {
              concurrent -= 1
              resolve()
            }
          })
        }
        concurrent -= 1
        return Promise.resolve()
      },
    })

    loop.schedule()
    await vi.advanceTimersByTimeAsync(500)
    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(false)

    loop.schedule()
    await vi.advanceTimersByTimeAsync(500)
    // Le premier run est annulé tout de suite ; le second attend qu'il soit vraiment
    // terminé, jamais deux processus Vitest à la fois.
    expect(signals[0]?.aborted).toBe(true)
    expect(signals).toHaveLength(1)

    releaseFirst?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(signals).toHaveLength(2)
    expect(signals[1]?.aborted).toBe(false)
    expect(maxConcurrent).toBe(1)
    loop.dispose()
  })

  it('runNow annule un debounce en attente : un seul run', async () => {
    const execute = vi.fn(() => Promise.resolve())
    const loop = new RunLoop({ debounceMs: () => 500, execute })

    loop.schedule()
    await loop.runNow()
    await vi.advanceTimersByTimeAsync(1000)
    expect(execute).toHaveBeenCalledTimes(1)
    loop.dispose()
  })

  it('dispose annule le run en cours et le debounce en attente', async () => {
    const execute = vi.fn(() => Promise.resolve())
    const loop = new RunLoop({ debounceMs: () => 500, execute })

    loop.schedule()
    loop.dispose()
    await vi.advanceTimersByTimeAsync(1000)
    expect(execute).not.toHaveBeenCalled()
  })
})
