import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { importParcours, type ImportHooks } from './importer.js'
import { loadParcours, type Parcours } from './parcours.js'
import { parseState } from './state.js'
import { ok, err } from './result.js'
import { parseResult } from '../runner/parse.js'
import { readFileSync } from 'node:fs'

/** Sortie Vitest réelle, voir src/runner/__fixtures__/README.md. */
const fixture = (name: string) =>
  parseResult(readFileSync(`src/runner/__fixtures__/${name}.json`, 'utf8'))

let workspace: string

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'learnpath-import-'))
})

/** Un parcours minimal mais réellement valide : on le fait passer par loadParcours. */
function parcours(overrides: Record<string, unknown> = {}): Parcours {
  const raw = {
    version: 1,
    slug: 'panier',
    title: 'Un panier',
    runner: {
      kind: 'vitest',
      cwd: '.',
      setup: ['npm i -D vitest'],
    },
    steps: [
      step('1.1', 'createPanier'),
      step('1.2', 'addItem'),
    ],
    ...overrides,
  }
  const loaded = loadParcours(raw)
  if (!loaded.ok) throw new Error(loaded.error.map((e) => e.message).join('\n'))
  return loaded.value
}

function step(id: string, fn: string): Record<string, unknown> {
  return {
    id,
    title: `Étape ${id}`,
    explanation: 'Pourquoi on fait ça.',
    expected: { files: ['src/panier.js'] },
    tests: {
      file: `.learn/tests/step-${id}.spec.js`,
      grep: `step ${id}`,
      content: `import { ${fn} } from '../../src/panier.js'\n`,
    },
    solution: { 'src/panier.js': `export function ${fn}() {}\n` },
  }
}

function hooks(overrides: Partial<ImportHooks> = {}): ImportHooks {
  return {
    confirm: () => Promise.resolve(true),
    log: () => undefined,
    exec: () => Promise.resolve(ok(undefined)),
    // Toutes les étapes rouges (fichier cible absent) : le cas nominal de l'import.
    runAll: () => Promise.resolve(fixture('a-fichier-absent')),
    // Et toutes vertes une fois les solutions appliquées. `verifyAllGreen` est testé pour
    // lui-même dans verify.test.ts, avec de vrais runs.
    runSteps: () => Promise.resolve(fixture('d-tout-passe')),
    ...overrides,
  }
}

const read = (relative: string): Promise<string> =>
  fs.readFile(path.join(workspace, relative), 'utf8')

const missing = async (relative: string): Promise<boolean> => {
  try {
    await fs.stat(path.join(workspace, relative))
    return false
  } catch {
    return true
  }
}

describe('import nominal', () => {
  it('crée les tests, la config, le parcours et le state', async () => {
    const result = await importParcours(parcours(), workspace, hooks())
    expect(result.ok).toBe(true)

    expect(await read('.learn/tests/step-1.1.spec.js')).toContain('createPanier')
    expect(await read('.learn/tests/step-1.2.spec.js')).toContain('addItem')
    expect(await read('.learn/parcours/panier.json')).toContain('"slug": "panier"')

    const config = await read('.learn/vitest.config.mts')
    expect(config).toContain(".learn/tests/**")
    expect(config).toContain('root: workspaceRoot')
    // D25 : le cache de Vite irait sinon dans node_modules/, partagé avec le vrai projet
    // quand la vérification des solutions tourne dans une copie.
    expect(config).toContain("cacheDir: fileURLToPath(new URL('.vite', import.meta.url))")

    const state = parseState(await read('.learn/state.json'))
    expect(state.ok && state.value.currentStepId).toBe('1.1')
  })

  it('joue chaque commande de setup après confirmation, dans le cwd du runner', async () => {
    const seen: string[] = []
    const result = await importParcours(
      parcours(),
      workspace,
      hooks({
        exec: (command, cwd) => {
          seen.push(`${command} @ ${cwd}`)
          return Promise.resolve(ok(undefined))
        },
      })
    )
    expect(result.ok).toBe(true)
    expect(seen).toEqual([`npm i -D vitest @ ${path.resolve(workspace)}`])
  })

  it('montre à l\'utilisateur les commandes exactes, sans reformulation', async () => {
    let shown: readonly string[] = []
    await importParcours(
      parcours(),
      workspace,
      hooks({
        confirm: (commands) => {
          shown = commands
          return Promise.resolve(true)
        },
      })
    )
    expect(shown).toEqual(['npm i -D vitest'])
  })

  it('ne touche pas au vitest.config.ts du projet ni à ses scripts npm', async () => {
    await fs.writeFile(path.join(workspace, 'vitest.config.ts'), 'ORIGINAL', 'utf8')
    await fs.writeFile(path.join(workspace, 'package.json'), '{"scripts":{"test":"vitest"}}', 'utf8')

    await importParcours(parcours(), workspace, hooks())

    expect(await read('vitest.config.ts')).toBe('ORIGINAL')
    expect(await read('package.json')).toBe('{"scripts":{"test":"vitest"}}')
  })
})

describe('.gitignore', () => {
  it('le crée s\'il est absent', async () => {
    await importParcours(parcours(), workspace, hooks())
    const content = await read('.gitignore')
    expect(content).toContain('.learn/state.json')
  })

  it('ajoute les entrées à la suite du contenu existant', async () => {
    await fs.writeFile(path.join(workspace, '.gitignore'), 'node_modules\n', 'utf8')
    await importParcours(parcours(), workspace, hooks())
    const content = await read('.gitignore')
    expect(content.startsWith('node_modules\n')).toBe(true)
    expect(content).toContain('.learn/state.json')
  })

  it('est idempotent : deux imports ne dupliquent aucune ligne', async () => {
    await importParcours(parcours(), workspace, hooks())
    const second = await importParcours(parcours(), workspace, hooks())
    expect(second.ok && second.value.gitignoreUpdated).toBe(false)

    const lines = (await read('.gitignore')).split('\n')
    expect(lines.filter((l) => l.trim() === '.learn/state.json')).toHaveLength(1)
  })

  it('ne réécrit pas une entrée déjà ajoutée à la main', async () => {
    await fs.writeFile(path.join(workspace, '.gitignore'), '.learn/state.json', 'utf8')
    await importParcours(parcours(), workspace, hooks())
    const lines = (await read('.gitignore')).split('\n').map((l) => l.trim())
    expect(lines.filter((l) => l === '.learn/state.json')).toHaveLength(1)
  })
})

describe('refus de confirmation', () => {
  it('annule l\'import et ne laisse pas de .learn/ derrière', async () => {
    const result = await importParcours(
      parcours(),
      workspace,
      hooks({ confirm: () => Promise.resolve(false) })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('Import annulé')
    expect(await missing('.learn')).toBe(true)
  })

  it('ne supprime pas un .learn/ préexistant, seulement ce qu\'il vient d\'écrire', async () => {
    await fs.mkdir(path.join(workspace, '.learn'), { recursive: true })
    await fs.writeFile(path.join(workspace, '.learn/notes.md'), 'à moi', 'utf8')

    await importParcours(parcours(), workspace, hooks({ confirm: () => Promise.resolve(false) }))

    expect(await read('.learn/notes.md')).toBe('à moi')
    expect(await missing('.learn/tests/step-1.1.spec.js')).toBe(true)
    expect(await missing('.learn/state.json')).toBe(true)
  })

  it('annule aussi si une commande de setup échoue', async () => {
    const result = await importParcours(
      parcours(),
      workspace,
      hooks({ exec: () => Promise.resolve(err('code de sortie 1')) })
    )
    expect(result.ok).toBe(false)
    expect(await missing('.learn')).toBe(true)
  })

  it('ne demande rien quand le parcours n\'a pas de setup', async () => {
    let asked = false
    const sansSetup = parcours({
      runner: {
        kind: 'vitest',
        cwd: '.',
      },
    })
    const result = await importParcours(
      sansSetup,
      workspace,
      hooks({
        confirm: () => {
          asked = true
          return Promise.resolve(true)
        },
      })
    )
    expect(result.ok).toBe(true)
    expect(asked).toBe(false)
  })
})

describe('slug conflictuel', () => {
  it('refuse sans rien écraser', async () => {
    await fs.mkdir(path.join(workspace, '.learn/parcours'), { recursive: true })
    await fs.writeFile(path.join(workspace, '.learn/parcours/auth-jwt.json'), '{"slug":"auth-jwt"}', 'utf8')

    const result = await importParcours(parcours(), workspace, hooks())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('auth-jwt')
    expect(await read('.learn/parcours/auth-jwt.json')).toBe('{"slug":"auth-jwt"}')
    expect(await missing('.learn/tests/step-1.1.spec.js')).toBe(true)
  })

  it('accepte de réimporter le même slug', async () => {
    await importParcours(parcours(), workspace, hooks())
    const again = await importParcours(parcours(), workspace, hooks())
    expect(again.ok).toBe(true)
  })
})

describe('écriture interrompue', () => {
  it('ne laisse aucun fichier partiel si une écriture échoue en cours de route', async () => {
    // Un dossier là où le deuxième test doit être écrit : `rename` échouera.
    await fs.mkdir(path.join(workspace, '.learn/tests/step-1.2.spec.js'), { recursive: true })

    const result = await importParcours(parcours(), workspace, hooks())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("rien n'a été conservé")
    expect(await missing('.learn/tests/step-1.1.spec.js')).toBe(true)
    expect(await missing('.learn/state.json')).toBe(true)
  })

  it('ne laisse aucun fichier temporaire derrière lui', async () => {
    await importParcours(parcours(), workspace, hooks())
    const files = await fs.readdir(path.join(workspace, '.learn/tests'))
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})

describe('le .gitignore de l\'utilisateur survit à un rollback', () => {
  it('est supprimé s\'il n\'existait pas', async () => {
    await importParcours(parcours(), workspace, hooks({ confirm: () => Promise.resolve(false) }))
    expect(await missing('.gitignore')).toBe(true)
  })

  it('retrouve son contenu d\'origine s\'il existait', async () => {
    await fs.writeFile(path.join(workspace, '.gitignore'), 'dist/\n')
    await importParcours(parcours(), workspace, hooks({ confirm: () => Promise.resolve(false) }))
    expect(await read('.gitignore')).toBe('dist/\n')
  })
})

describe('vérification « tout doit être rouge » (D5)', () => {
  it('annule l\'import et nettoie si une étape passe déjà', async () => {
    const result = await importParcours(
      parcours(),
      workspace,
      hooks({ runAll: () => Promise.resolve(fixture('d-tout-passe')) })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/« 1\.1 — Étape 1\.1 », « 1\.2 — Étape 1\.2 » passent déjà/)
      expect(result.error).toMatch(/Rien n'a été conservé/)
    }
    expect(await missing('.learn')).toBe(true)
  })

  it('annule aussi si les tests n\'ont pas pu être lancés', async () => {
    const result = await importParcours(
      parcours(),
      workspace,
      hooks({ runAll: () => Promise.resolve(err('Vitest n\'a produit aucun rapport.')) })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/La vérification du parcours n'a pas pu être faite/)
    expect(await missing('.learn')).toBe(true)
  })
})
