import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { validateCommand } from './validate-commands.js'
import { loadParcours, type Parcours, type Step } from './parcours.js'
import { notFoundMessage, pythonFor, setupLauncher, venvPython } from './exec.js'
import { humanize } from './humanize.js'
import { verifyAllRed } from './verify.js'
import { importParcours, type ImportHooks } from './importer.js'
import { ok } from './result.js'
import type { ResolvedPath } from './paths.js'
import { parseJunit } from '../runner/junit.js'
import { labelByStep } from '../runner/pytest.js'
import { classify } from '../runner/classify.js'
import type { RawResult } from '../runner/parse.js'

// D39 — l'ouverture à Python. Tout ce qui ne demande pas de lancer pytest est ici, sur les
// rapports JUnit **réels** de `src/runner/__fixtures__/pytest/`. Les vrais runs sont dans
// `src/runner/pytest.test.ts`.

const EXEMPLE = 'examples/exemple-panier-python.json'

interface Brut {
  runner: Record<string, unknown>
  steps: Array<Record<string, unknown> & { tests: Record<string, unknown> }>
  [key: string]: unknown
}

const brut = (): Brut => JSON.parse(readFileSync(EXEMPLE, 'utf8')) as Brut

const exemple: Parcours = (() => {
  const r = loadParcours(brut())
  if (!r.ok) throw new Error(r.error.map((e) => e.message).join('\n'))
  return r.value
})()

function etape(id: string): Step {
  const step = exemple.steps.find((s) => s.id === id)
  if (step === undefined) throw new Error(`étape ${id} absente de ${EXEMPLE}`)
  return step
}

/** Rapport réel, lu comme le fait `runPytest` : parse, puis nom de l'étape en tête. */
function fixture(name: string, steps: readonly Step[] = exemple.steps): RawResult {
  const r = parseJunit(
    readFileSync(`src/runner/__fixtures__/pytest/${name}.xml`, 'utf8'),
    steps.map((s) => s.tests.file)
  )
  if (!r.ok) throw new Error(`${name} : ${r.error}`)
  return { ...r.value, files: labelByStep(r.value.files, steps) }
}

function casse(mutate: (p: Brut) => void): string {
  const p = brut()
  mutate(p)
  const r = loadParcours(p)
  if (r.ok) throw new Error('le parcours aurait dû être refusé')
  return r.error.map((e) => e.message).join('\n')
}

// --- Le format -----------------------------------------------------------------------------

describe('loadParcours — pytest', () => {
  it(`accepte ${EXEMPLE}`, () => {
    expect(exemple.slug).toBe('panier-python')
    expect(exemple.runner.kind).toBe('pytest')
    expect(exemple.steps).toHaveLength(5)
  })

  it("refuse runner.environment, qui n'a de sens que pour Vitest", () => {
    expect(casse((p) => (p.runner['environment'] = 'node'))).toMatch(/environment : il ne s'applique qu'à Vitest/)
  })

  it("refuse un fichier de test qui n'est pas un nom de module Python, et propose le bon", () => {
    const message = casse((p) => {
      const first = p.steps[0]
      if (first) first.tests['file'] = '.learn/tests/step-1.1.py'
    })
    expect(message).toMatch(/Étape 1\.1 : avec pytest, le fichier de test doit être un module Python/)
    expect(message).toContain('test_step_1_1.py')
  })

  it("refuse un fichier de test JavaScript dans un parcours pytest", () => {
    expect(
      casse((p) => {
        const first = p.steps[0]
        if (first) first.tests['file'] = '.learn/tests/step-1.1.spec.js'
      })
    ).toMatch(/doit être un module Python/)
  })

  it("refuse une commande npm dans le setup d'un parcours pytest", () => {
    expect(casse((p) => (p.runner['setup'] = ['npm i -D vitest']))).toMatch(
      /Runner, setup\[0\] : la commande doit commencer par pip, pip3, python, python3, uv, poetry/
    )
  })

  it("n'exige toujours pas « step <id> » dans le nom des tests Python, mais bien dans grep", () => {
    expect(
      casse((p) => {
        const first = p.steps[0]
        if (first) first.tests['grep'] = 'panier vide'
      })
    ).toMatch(/tests\.grep vaut « panier vide » mais doit contenir « step 1\.1 »/)
  })
})

describe('validateCommand — pytest', () => {
  const VALIDES = [
    'pip install pytest',
    'pip3 install -r requirements.txt',
    'python -m venv .venv',
    'python3 -m venv --upgrade-deps venv',
    'python -m pip install pytest',
    'uv add --dev pytest',
    'poetry add --group dev pytest',
  ]
  for (const cmd of VALIDES) {
    it(`accepte : ${cmd}`, () => {
      expect(validateCommand(cmd, 'pytest')).toEqual({ ok: true, value: cmd })
    })
  }

  const REFUS: ReadonlyArray<readonly [string, string, string]> = [
    ['un gestionnaire JavaScript', 'npm i -D vitest', 'doit commencer par pip'],
    ['un script Python', 'python install.py', 'python -m venv'],
    ['python -c', 'python -c import os', 'python -m venv'],
    ['un module arbitraire', 'python -m http.server', 'python -m venv'],
    ['un venv hors du projet', 'python -m venv ../ailleurs', 'remonte hors du projet'],
    ['un venv en chemin absolu', 'python -m venv /tmp/venv', 'absolu'],
    ['un venv sans dossier', 'python -m venv', 'un seul dossier'],
    ['un enchaînement', 'pip install pytest && rm -rf /', 'métacaractère'],
  ]
  for (const [nom, cmd, attendu] of REFUS) {
    it(`refuse ${nom} : ${cmd}`, () => {
      const r = validateCommand(cmd, 'pytest')
      expect(r.ok, `${nom} aurait dû être refusé`).toBe(false)
      if (!r.ok) expect(r.error).toContain(attendu)
    })
  }

  it("refuse pip dans un parcours Vitest : la liste blanche suit le runner", () => {
    const r = validateCommand('pip install pytest', 'vitest')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('doit commencer par npm, npx, pnpm, yarn')
  })
})

// --- Classification sur rapports réels ----------------------------------------------------

describe('classify — pytest', () => {
  it("module pas encore créé : missing-file, et rien à afficher", () => {
    const raw = fixture('a-fichier-absent')
    for (const step of exemple.steps) {
      const c = classify(raw, step)
      expect(c.state, `étape ${step.id}`).toBe('missing-file')
      expect(c.message).toBeUndefined()
    }
  })

  // La différence avec JavaScript : `from panier import ajouter_article` échoue à la
  // collecte dès que le module existe sans la fonction. C'est l'état normal du début de
  // chaque étape après la première, pas un « fichier pas encore valide ».
  it("fonction de l'étape pas encore écrite dans un module existant : missing-file", () => {
    const raw = fixture('e-nom-pas-encore-ecrit')
    expect(classify(raw, etape('1.1')).state).toBe('pass')
    const c = classify(raw, etape('1.2'))
    expect(c.state).toBe('missing-file')
    expect(c.missing).toBe('panier.ajouter_article')
  })

  it('code en cours d\'écriture (syntaxe invalide) : collect-error', () => {
    const c = classify(fixture('b-syntaxe-invalide'), etape('1.1'))
    expect(c.state).toBe('collect-error')
    expect(c.message).toContain('SyntaxError: invalid syntax')
  })

  it('assertion en échec : assertion-failed, nommée par son étape', () => {
    const c = classify(fixture('c-assertion-echouee', [etape('1.1')]), etape('1.1'))
    expect(c.state).toBe('assertion-failed')
    expect(c.failures.map((f) => f.fullName)).toEqual(['step 1.1 › test_lignes_vides_et_aucune_promo'])
    expect(c.message).toContain('assert [1] == []')
  })

  it('tout passe : pass', () => {
    const raw = fixture('d-tout-passe')
    for (const step of exemple.steps) expect(classify(raw, step).state, `étape ${step.id}`).toBe('pass')
  })

  it("un module introuvable hors expected.files n'est pas avalé en missing-file", () => {
    const c = classify(fixture('f-module-inattendu', [etape('1.1')]), etape('1.1'))
    expect(c.state).toBe('collect-error')
    expect(c.message).toContain('helpers_inexistants')
  })

  it('un fichier de test mal indenté : collect-error', () => {
    const c = classify(fixture('h-test-mal-forme', [etape('1.1')]), etape('1.1'))
    expect(c.state).toBe('collect-error')
    expect(c.message).toContain('IndentationError')
  })

  it("« step 1.1 » n'attrape pas « step 1.10 »", () => {
    const dixieme: Step = { ...etape('1.1'), id: '1.10' }
    expect(classify(fixture('d-tout-passe'), dixieme).state).not.toBe('pass')
  })

  it("rapproche le module d'un fichier dans un paquet, pas d'un nom voisin", () => {
    const raw = fixture('a-fichier-absent')
    const dans = (file: string): Step => ({ ...etape('1.1'), expected: { ...etape('1.1').expected, files: [file] } })
    expect(classify(raw, dans('boutique/panier.py')).state).toBe('missing-file')
    expect(classify(raw, dans('src/panier/__init__.py')).state).toBe('missing-file')
    expect(classify(raw, dans('panier_v2.py')).state).toBe('collect-error')
  })
})

describe('humanize — pytest', () => {
  const g = fixture('g-messages-frequents', [{ ...etape('1.1'), id: '2.1', tests: { ...etape('1.1').tests, file: '.learn/tests/test_step_2_1.py' } }])
  const message = (test: string): string => {
    const found = g.files.flatMap((f) => f.assertions).find((a) => a.fullName.endsWith(test))
    const first = found?.failureMessages[0]
    if (first === undefined) throw new Error(`aucun message pour ${test}`)
    return first
  }
  const traduit = (test: string): string => {
    const text = humanize(message(test), 'run')
    if (text === undefined) throw new Error(`forme non reconnue : ${message(test)}`)
    return text
  }

  it('attribut absent du module', () => {
    expect(traduit('test_attribut_absent')).toBe("Le module « panier » ne définit pas « total » : pas encore écrit, ou écrit sous un autre nom.")
  })
  it('trop d\'arguments', () => {
    expect(traduit('test_trop_d_arguments')).toContain('« creer_panier() » accepte 0 argument(s) positionnel(s) mais en a reçu 1')
  })
  it('argument manquant', () => {
    expect(traduit('test_argument_manquant')).toContain("il manque : 'b'")
  })
  it('clé absente', () => {
    expect(traduit('test_cle_absente')).toBe('La clé « articles » est absente du dictionnaire lu.')
  })
  it('None lu comme un dictionnaire', () => {
    expect(traduit('test_none')).toContain('sans « return » renvoie None')
  })
  it('nom inconnu', () => {
    expect(traduit('test_nom_inconnu')).toContain('« inconnu » n\'est défini nulle part')
  })

  // Règle 3 de humanize : `assert a == b` ne dit pas lequel est l'attendu. On ne devine pas.
  it("ne sépare pas obtenu et attendu sur un assert Python, faute de savoir lequel est lequel", () => {
    expect(humanize(message('test_egalite'), 'run')).toBeUndefined()
  })

  it('module introuvable et nom pas encore écrit, à la collecte', () => {
    const a = fixture('a-fichier-absent').files[0]?.message ?? ''
    expect(humanize(a, 'collect')).toContain('Le module Python « panier » est introuvable')
    const e = fixture('e-nom-pas-encore-ecrit').files.find((f) => f.message !== '')?.message ?? ''
    expect(humanize(e, 'collect')).toContain('Le module « panier » ne définit pas « ajouter_article »')
  })

  it("syntaxe et indentation invalides à la collecte, jamais traduites à l'exécution", () => {
    const b = fixture('b-syntaxe-invalide').files[0]?.message ?? ''
    const h = fixture('h-test-mal-forme', [etape('1.1')]).files[0]?.message ?? ''
    expect(humanize(b, 'collect')).toContain("n'est pas du Python valide (SyntaxError")
    expect(humanize(h, 'collect')).toContain("n'est pas du Python valide (IndentationError")
    expect(humanize(b, 'run')).toBeUndefined()
  })
})

describe('verifyAllRed — pytest', () => {
  const root = '/projet' as ResolvedPath

  it("accepte l'exemple : les cinq étapes sont rouges avant écriture", async () => {
    const r = await verifyAllRed(exemple, root, () => Promise.resolve(ok(fixture('a-fichier-absent'))))
    expect(r.ok).toBe(true)
  })

  it('refuse un parcours dont les étapes passent déjà', async () => {
    const r = await verifyAllRed(exemple, root, () => Promise.resolve(ok(fixture('d-tout-passe'))))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('passent déjà')
  })
})

// --- Résolution de l'interpréteur ----------------------------------------------------------

describe('pythonFor et setupLauncher', () => {
  let dir: string
  const avant = { PATH: process.env['PATH'], VIRTUAL_ENV: process.env['VIRTUAL_ENV'] }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'learnpath-python-'))
  })
  afterEach(async () => {
    process.env['PATH'] = avant.PATH
    if (avant.VIRTUAL_ENV === undefined) delete process.env['VIRTUAL_ENV']
    else process.env['VIRTUAL_ENV'] = avant.VIRTUAL_ENV
    await fs.rm(dir, { recursive: true, force: true })
  })

  async function fauxPython(file: string): Promise<string> {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, '', { mode: 0o755 })
    return file
  }
  const pathPython = (bin: string): string => path.join(bin, process.platform === 'win32' ? 'python.exe' : 'python3')

  it("préfère le .venv du projet à l'environnement activé et au PATH", async () => {
    const local = await fauxPython(venvPython(path.join(dir, 'projet', '.venv')))
    process.env['VIRTUAL_ENV'] = path.join(dir, 'actif')
    await fauxPython(venvPython(path.join(dir, 'actif')))
    const launch = pythonFor([path.join(dir, 'projet')])
    expect(launch.resolved).toBe(true)
    expect(launch.file).toBe(local)
  })

  it('reconnaît aussi « venv », après « .venv »', async () => {
    const venv = await fauxPython(venvPython(path.join(dir, 'venv')))
    expect(pythonFor([dir]).file).toBe(venv)
    const dot = await fauxPython(venvPython(path.join(dir, '.venv')))
    expect(pythonFor([dir]).file).toBe(dot)
  })

  it("prend l'environnement activé (VIRTUAL_ENV) quand le projet n'en a pas", async () => {
    process.env['VIRTUAL_ENV'] = path.join(dir, 'actif')
    const actif = await fauxPython(venvPython(path.join(dir, 'actif')))
    expect(pythonFor([path.join(dir, 'projet')]).file).toBe(actif)
  })

  it("retombe sur le Python du PATH, mais jamais sur l'alias du Microsoft Store", async () => {
    delete process.env['VIRTUAL_ENV']
    await fauxPython(pathPython(path.join(dir, 'WindowsApps')))
    process.env['PATH'] = path.join(dir, 'WindowsApps')
    expect(pythonFor([path.join(dir, 'projet')]).resolved).toBe(false)

    const systeme = await fauxPython(pathPython(path.join(dir, 'bin')))
    process.env['PATH'] = [path.join(dir, 'WindowsApps'), path.join(dir, 'bin')].join(path.delimiter)
    expect(pythonFor([path.join(dir, 'projet')]).file).toBe(systeme)
  })

  it("dit qu'il n'a rien trouvé, avec les chemins examinés et un message Python", () => {
    delete process.env['VIRTUAL_ENV']
    process.env['PATH'] = ''
    const launch = setupLauncher('pip install pytest', dir)
    expect(launch.resolved).toBe(false)
    expect(launch.tried).toContain(venvPython(path.join(dir, '.venv')))
    expect(notFoundMessage('pip install pytest', launch)).toContain("Aucun interpréteur Python n'a été trouvé")
  })

  it('lance pip avec le Python du projet, jamais le pip du PATH', async () => {
    const local = await fauxPython(venvPython(path.join(dir, '.venv')))
    const launch = setupLauncher('pip install pytest', dir)
    expect(launch.file).toBe(local)
    expect(launch.args).toEqual(['-m', 'pip', 'install', 'pytest'])
  })

  it("crée le venv avec le Python du système, et ne le recrée pas s'il existe", async () => {
    process.env['VIRTUAL_ENV'] = path.join(dir, 'actif')
    await fauxPython(venvPython(path.join(dir, 'actif')))
    const systeme = await fauxPython(pathPython(path.join(dir, 'bin')))
    process.env['PATH'] = path.join(dir, 'bin')

    const creation = setupLauncher('python -m venv .venv', dir)
    expect(creation.skip).toBeUndefined()
    expect(creation.file).toBe(systeme)
    expect(creation.args).toEqual(['-m', 'venv', '.venv'])

    await fauxPython(venvPython(path.join(dir, '.venv')))
    expect(setupLauncher('python -m venv .venv', dir).skip).toContain('existe déjà')
  })
})

// --- Import (runs injectés) ----------------------------------------------------------------

describe('importParcours — pytest', () => {
  let workspace: string
  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'learnpath-import-py-'))
  })
  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true })
  })

  const hooks: ImportHooks = {
    confirm: () => Promise.resolve(true),
    log: () => undefined,
    exec: () => Promise.resolve(ok(undefined)),
    runAll: () => Promise.resolve(ok(fixture('a-fichier-absent'))),
    runSteps: () => Promise.resolve(ok(fixture('d-tout-passe'))),
  }
  const read = (relative: string): Promise<string> => fs.readFile(path.join(workspace, relative), 'utf8')

  it('écrit les tests .py et la config pytest, pas de config Vitest', async () => {
    const r = await importParcours(exemple, workspace, hooks)
    expect(r.ok).toBe(true)
    expect(await read('.learn/tests/test_step_1_2.py')).toContain('from panier import ajouter_article')
    const ini = await read('.learn/pytest.ini')
    expect(ini).toContain('[pytest]')
    expect(ini).toContain('pythonpath = ..')
    await expect(fs.stat(path.join(workspace, '.learn/vitest.config.mts'))).rejects.toThrow()
  })

  it("ignore la progression, et n'ajoute pas le cache de Vite au .gitignore", async () => {
    await importParcours(exemple, workspace, hooks)
    const gitignore = await read('.gitignore')
    expect(gitignore).toContain('.learn/state.json')
    expect(gitignore).not.toContain('.vite')
  })

  it('ne touche à aucune config pytest du projet', async () => {
    await fs.writeFile(path.join(workspace, 'pytest.ini'), 'ORIGINAL', 'utf8')
    await fs.writeFile(path.join(workspace, 'pyproject.toml'), 'ORIGINAL', 'utf8')
    await fs.writeFile(path.join(workspace, 'conftest.py'), 'ORIGINAL', 'utf8')
    await importParcours(exemple, workspace, hooks)
    for (const file of ['pytest.ini', 'pyproject.toml', 'conftest.py']) expect(await read(file)).toBe('ORIGINAL')
  })

  it('le rollback enlève aussi la config pytest', async () => {
    const r = await importParcours(exemple, workspace, { ...hooks, confirm: () => Promise.resolve(false) })
    expect(r.ok).toBe(false)
    await expect(fs.stat(path.join(workspace, '.learn/pytest.ini'))).rejects.toThrow()
  })
})
