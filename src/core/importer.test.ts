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
  it("annule l'import et ne laisse derrière que le fichier de parcours (D28)", async () => {
    const result = await importParcours(
      parcours(),
      workspace,
      hooks({ confirm: () => Promise.resolve(false) })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('Import annulé')
    expect(await read('.learn/parcours/panier.json')).toContain('"slug": "panier"')
    expect(await missing('.learn/tests/step-1.1.spec.js')).toBe(true)
    expect(await missing('.learn/state.json')).toBe(true)
    expect(await missing('.learn/vitest.config.mts')).toBe(true)
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
    expect(await missing('.learn/tests/step-1.1.spec.js')).toBe(true)
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

describe('slug conflictuel (D44)', () => {
  const archive = '{"slug":"auth-jwt"}'
  const stateOf = (slug: string): string =>
    JSON.stringify({ version: 1, slug, currentStepId: '1.1', hintsRevealed: {}, solutionsRevealed: [] })

  it('refuse sans rien écraser quand un autre parcours est en cours', async () => {
    await fs.mkdir(path.join(workspace, '.learn/parcours'), { recursive: true })
    await fs.writeFile(path.join(workspace, '.learn/parcours/auth-jwt.json'), archive, 'utf8')
    await fs.writeFile(path.join(workspace, '.learn/state.json'), stateOf('auth-jwt'), 'utf8')

    const result = await importParcours(parcours(), workspace, hooks())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('« auth-jwt » est en cours')
    expect(result.error).toContain('Supprimer le parcours')
    expect(await read('.learn/parcours/auth-jwt.json')).toBe(archive)
    expect(await read('.learn/state.json')).toBe(stateOf('auth-jwt'))
    expect(await missing('.learn/tests/step-1.1.spec.js')).toBe(true)
  })

  it('importe à côté des parcours conservés quand aucun n’est en cours, sans y toucher', async () => {
    // L'état laissé par « Supprimer le parcours » : les JSON restent, plus de state.json.
    // C'est le cycle d'une série — finir, réinitialiser, importer le suivant.
    await fs.mkdir(path.join(workspace, '.learn/parcours'), { recursive: true })
    await fs.writeFile(path.join(workspace, '.learn/parcours/auth-jwt.json'), archive, 'utf8')
    await fs.writeFile(path.join(workspace, '.learn/parcours/z-suite.json'), '{"slug":"z-suite"}', 'utf8')

    const result = await importParcours(parcours(), workspace, hooks())
    if (!result.ok) throw new Error(result.error)
    expect(await read('.learn/parcours/auth-jwt.json')).toBe(archive)
    const state = parseState(await read('.learn/state.json'))
    expect(state.ok && state.value.slug).toBe('panier')
  })

  it('un state illisible ne désigne aucun parcours en cours et ne bloque pas l’import', async () => {
    await fs.mkdir(path.join(workspace, '.learn/parcours'), { recursive: true })
    await fs.writeFile(path.join(workspace, '.learn/parcours/auth-jwt.json'), archive, 'utf8')
    await fs.writeFile(path.join(workspace, '.learn/state.json'), '{cassé', 'utf8')
    expect((await importParcours(parcours(), workspace, hooks())).ok).toBe(true)
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
    expect(result.error).toContain("Rien n'a été conservé")
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
      expect(result.error).toMatch(/Le fichier de parcours est conservé/)
    }
    expect(await missing('.learn/tests/step-1.1.spec.js')).toBe(true)
  })

  it('annule aussi si les tests n\'ont pas pu être lancés', async () => {
    const result = await importParcours(
      parcours(),
      workspace,
      hooks({ runAll: () => Promise.resolve(err('Vitest n\'a produit aucun rapport.')) })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/La vérification du parcours n'a pas pu être faite/)
    expect(await missing('.learn/tests/step-1.1.spec.js')).toBe(true)
  })
})

// --- D28 : le parcours survit à un échec tardif ------------------------------------------
//
// Le fichier de parcours est la seule chose non reproductible du système : un LLM ne
// régénère jamais deux fois la même sortie, et le générateur écrit justement dans
// .learn/parcours/<slug>.json. Le rollback ne doit pas l'emporter.

describe("le fichier de parcours survit au rollback (D28)", () => {
  const echecs: readonly [string, () => Partial<ImportHooks>][] = [
    ['setup', () => ({ exec: () => Promise.resolve(err('spawn npm ENOENT')) })],
    ['verifyAllRed', () => ({ runAll: () => Promise.resolve(fixture('d-tout-passe')) })],
    ['verifyAllGreen', () => ({ runSteps: () => Promise.resolve(fixture('a-fichier-absent')) })],
  ]

  for (const [nom, override] of echecs) {
    it(`échec ${nom} : le parcours reste sur disque et le message dit où`, async () => {
      const result = await importParcours(parcours(), workspace, hooks(override()))

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toContain('.learn/parcours/panier.json')

      const conserve = JSON.parse(await read('.learn/parcours/panier.json')) as { slug: string }
      expect(conserve.slug).toBe('panier')
      // Et rien d'autre : le rollback fait son travail par ailleurs.
      expect(await missing('.learn/tests/step-1.1.spec.js')).toBe(true)
      expect(await missing('.learn/state.json')).toBe(true)
      expect(await missing('.learn/vitest.config.mts')).toBe(true)
    })

    it(`échec ${nom} : un .learn/ préexistant n'est pas emporté non plus`, async () => {
      await fs.mkdir(path.join(workspace, '.learn'), { recursive: true })
      await fs.writeFile(path.join(workspace, '.learn/notes.md'), 'à moi', 'utf8')

      await importParcours(parcours(), workspace, hooks(override()))

      expect(await read('.learn/notes.md')).toBe('à moi')
      expect(await read('.learn/parcours/panier.json')).toContain('"slug": "panier"')
    })
  }

  it('réimporter après un échec tardif reste possible', async () => {
    await importParcours(parcours(), workspace, hooks({ exec: () => Promise.resolve(err('spawn npm ENOENT')) }))
    const second = await importParcours(parcours(), workspace, hooks())
    expect(second.ok).toBe(true)
  })
})

const NL = '\n'

// --- D31 : la config générée hérite de l'écosystème du projet ----------------------------
//
// Un projet React a besoin de son plugin et d'un environnement DOM. Reconstruire ça à la
// main redevient faux au prochain écosystème : on part de la config Vite du projet.

describe('config Vitest générée (D31)', () => {
  const viteConfig = (contenu: string): Promise<void> =>
    fs.writeFile(path.join(workspace, 'vite.config.ts'), contenu, 'utf8')

  it('projet vanilla sans config Vite : config autonome, environnement node', async () => {
    await importParcours(parcours(), workspace, hooks())
    const config = await read('.learn/vitest.config.mts')

    expect(config).not.toContain('mergeConfig')
    expect(config).toContain("environment: 'node'")
    expect(config).toContain('root: workspaceRoot')
  })

  it('projet avec vite.config.ts : hérite de ses plugins et de ses alias', async () => {
    await viteConfig("export default { plugins: [] }" + NL)
    await importParcours(parcours(), workspace, hooks())
    const config = await read('.learn/vitest.config.mts')

    expect(config).toContain("import projet from '../vite.config.ts'")
    expect(config).toContain('mergeConfig(base,')
    // Le bloc `test` du projet est écarté : sa config de test ne s'applique pas ici (D3).
    expect(config).toContain('const { test: _test, ...base } = resolu')
  })

  it('config Vite exportée sous forme de fonction : elle est appelée, pas fusionnée telle quelle', async () => {
    await viteConfig("export default () => ({ plugins: [] })" + NL)
    await importParcours(parcours(), workspace, hooks())
    expect(await read('.learn/vitest.config.mts')).toContain(
      "typeof projet === 'function' ? await projet(env) : await projet"
    )
  })

  it('trouve aussi une config Vite en .js', async () => {
    await fs.writeFile(path.join(workspace, 'vite.config.js'), 'export default {}' + NL, 'utf8')
    await importParcours(parcours(), workspace, hooks())
    expect(await read('.learn/vitest.config.mts')).toContain("import projet from '../vite.config.js'")
  })

  it("n'hérite jamais du vitest.config.ts du projet, qui est sa config de test", async () => {
    await fs.writeFile(path.join(workspace, 'vitest.config.ts'), 'export default {}' + NL, 'utf8')
    await importParcours(parcours(), workspace, hooks())
    expect(await read('.learn/vitest.config.mts')).not.toContain('vitest.config')
  })

  it('runner.environment est repris tel quel', async () => {
    const react = parcours({ runner: { kind: 'vitest', cwd: '.', environment: 'jsdom', setup: [] } })
    await importParcours(react, workspace, hooks())
    expect(await read('.learn/vitest.config.mts')).toContain("environment: 'jsdom'")
  })

  // Les parcours écrits avant D31 n'ont pas le champ, mais installent jsdom : c'est le
  // cas remonté du terrain, et il doit marcher sans régénérer le parcours.
  it("sans le champ, déduit jsdom du setup qui l'installe", async () => {
    const react = parcours({
      runner: { kind: 'vitest', cwd: '.', setup: ['npm i -D vitest jsdom @testing-library/react'] },
    })
    await importParcours(react, workspace, hooks())
    expect(await read('.learn/vitest.config.mts')).toContain("environment: 'jsdom'")
  })

  it("un setup qui n'installe pas de DOM reste en node", async () => {
    await importParcours(parcours(), workspace, hooks())
    expect(await read('.learn/vitest.config.mts')).toContain("environment: 'node'")
  })
})
