import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { loadParcours, type Parcours } from '../core/parcours.js'
import { pythonFor } from '../core/exec.js'
import { importParcours } from '../core/importer.js'
import { loadSession, runCurrentStep, type Session } from '../core/progression.js'
import { safeResolve } from '../core/paths.js'
import { runPytest } from './pytest.js'

// --- Vrais runs pytest (D39) ---------------------------------------------------------------
//
// Comme pour Vitest (verify.test.ts), la seule preuve qui compte est un vrai processus :
// une fausse sortie ne prouverait que la mise en forme. Il faut un Python avec pytest,
// trouvé comme le fait l'extension (`.venv`, VIRTUAL_ENV, PATH). Absent, ces tests sont
// sautés — sauf si LEARNPATH_REQUIRE_PYTEST=1, ce que fait la CI : un saut silencieux
// ferait passer la CI sans avoir rien vérifié.

const python = pythonFor([])
const pytestPresent =
  python.resolved && spawnSync(python.file, [...python.args, '-m', 'pytest', '--version']).status === 0
if (!pytestPresent && process.env['LEARNPATH_REQUIRE_PYTEST'] === '1') {
  throw new Error(`LEARNPATH_REQUIRE_PYTEST=1 mais aucun Python avec pytest : ${python.tried.join(', ')}`)
}

const exemple: Parcours = (() => {
  const raw = JSON.parse(readFileSync('examples/exemple-panier-python.json', 'utf8')) as Record<string, unknown>
  const r = loadParcours({ ...raw, runner: { kind: 'pytest', cwd: '.', setup: [] } })
  if (!r.ok) throw new Error(r.error.map((e) => e.message).join('\n'))
  return r.value
})()

const solution = (id: string): string => {
  const content = exemple.steps.find((s) => s.id === id)?.solution['panier.py']
  if (content === undefined) throw new Error(`pas de solution pour ${id}`)
  return content
}

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'learnpath-pytest-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const hooks = { confirm: () => Promise.resolve(true), log: () => undefined }

/** Tout chemin du projet qui contient un cache Python : aucun ne doit apparaître. */
async function caches(root: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await fs.readdir(root, { withFileTypes: true, recursive: true })) {
    if (entry.name === '__pycache__' || entry.name === '.pytest_cache') {
      found.push(path.relative(root, path.join(entry.parentPath, entry.name)))
    }
  }
  return found
}

describe.skipIf(!pytestPresent)('pytest réel', { timeout: 120_000 }, () => {
  it("importe le parcours d'exemple : toutes les étapes rouges, puis les solutions cumulées vertes", async () => {
    const r = await importParcours(exemple, dir, hooks)
    expect(r.ok ? '' : r.error).toBe('')
    expect((await fs.readdir(dir)).sort()).toEqual(['.gitignore', '.learn'])
    // Règle 3 : ni bytecode ni cache pytest, ni dans le projet ni sous .learn/.
    expect(await caches(dir)).toEqual([])
  })

  it("joue la boucle : pas commencé, validé, étape suivante pas commencée, code invalide", async () => {
    expect((await importParcours(exemple, dir, hooks)).ok).toBe(true)
    const loaded = await loadSession(dir)
    if (!loaded.ok) throw new Error(loaded.error)
    let session: Session = loaded.value

    const play = async (): Promise<NonNullable<Awaited<ReturnType<typeof runCurrentStep>>>> => {
      const outcome = await runCurrentStep(session, { gitCheckpoints: false })
      if (outcome.ok) session = { ...session, state: outcome.value.state }
      return outcome
    }

    const debut = await play()
    expect(debut.ok && debut.value.result.state).toBe('missing-file')

    await fs.writeFile(path.join(dir, 'panier.py'), solution('1.1'))
    const valide = await play()
    expect(valide.ok && [valide.value.result.state, valide.value.advanced]).toEqual(['pass', true])
    expect(session.state.currentStepId).toBe('1.2')

    // Le module existe, la fonction de l'étape non : c'est un début d'étape, pas une erreur.
    const suivante = await play()
    expect(suivante.ok && suivante.value.result.state).toBe('missing-file')
    expect(suivante.ok && suivante.value.regressions).toEqual([])
    expect(suivante.ok && suivante.value.summary).toBe('')

    await fs.writeFile(path.join(dir, 'panier.py'), 'def creer_panier(:\n')
    const invalide = await play()
    expect(invalide.ok && invalide.value.result.state).toBe('collect-error')

    await fs.writeFile(path.join(dir, 'panier.py'), solution('1.2').replace('"lignes": []', '"lignes": [0]'))
    const echec = await play()
    expect(echec.ok && echec.value.result.state).toBe('assertion-failed')
    expect(echec.ok && echec.value.regressions.map((r) => r.step.id)).toEqual(['1.1'])

    await fs.writeFile(path.join(dir, 'panier.py'), solution('1.2'))
    const deux = await play()
    expect(deux.ok && deux.value.summary).toContain('Étape 1.2 validée')
    expect(session.state.currentStepId).toBe('1.3')
    expect(await caches(dir)).toEqual([])
  })

  // D3 : un addopts qui ferait planter pytest, et un conftest.py qui lève dès qu'il est
  // chargé. Si l'un des deux était lu, l'import échouerait.
  it("n'applique ni la config pytest du projet ni son conftest.py", async () => {
    await fs.writeFile(path.join(dir, 'pytest.ini'), '[pytest]\naddopts = --option-qui-n-existe-pas\n')
    await fs.writeFile(path.join(dir, 'conftest.py'), 'raise RuntimeError("conftest du projet chargé")\n')
    const r = await importParcours(exemple, dir, hooks)
    expect(r.ok ? '' : r.error).toBe('')
    expect(await fs.readFile(path.join(dir, 'pytest.ini'), 'utf8')).toBe('[pytest]\naddopts = --option-qui-n-existe-pas\n')
  })

  it("importe le code d'un paquet du projet (« from app.panier import … »)", async () => {
    const enPaquet = loadParcours(
      JSON.parse(
        JSON.stringify(exemple)
          .replaceAll('from panier import', 'from app.panier import')
          .replaceAll('"panier.py"', '"app/panier.py"')
      )
    )
    if (!enPaquet.ok) throw new Error(enPaquet.error.map((e) => e.message).join('\n'))
    const r = await importParcours(enPaquet.value, dir, hooks)
    expect(r.ok ? '' : r.error).toBe('')
  })

  it("refuse une solution Python qui casse l'étape précédente, en la nommant", async () => {
    const regressive = loadParcours(
      JSON.parse(
        JSON.stringify(exemple).replace(
          JSON.stringify(solution('1.2')),
          JSON.stringify(solution('1.2').replace('{"lignes": [], "promo": None}', '{"lignes": []}'))
        )
      )
    )
    if (!regressive.ok) throw new Error(regressive.error.map((e) => e.message).join('\n'))
    const r = await importParcours(regressive.value, dir, hooks)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("la solution de l'étape « 1.2 — Ajouter un article » casse l'étape « 1.1 — Créer un panier vide »")
      expect(await fs.readFile(path.join(dir, '.learn', 'verify.log'), 'utf8')).toContain("KeyError: 'promo'")
    }
  })
})

describe('runPytest sans pytest utilisable', () => {
  const avant = { PATH: process.env['PATH'], VIRTUAL_ENV: process.env['VIRTUAL_ENV'] }
  afterEach(() => {
    process.env['PATH'] = avant.PATH
    if (avant.VIRTUAL_ENV === undefined) delete process.env['VIRTUAL_ENV']
    else process.env['VIRTUAL_ENV'] = avant.VIRTUAL_ENV
  })

  const root = (): ReturnType<typeof safeResolve> => safeResolve(dir, '.', { allowRoot: true })

  it("explique qu'aucun Python n'est trouvé au lieu d'un ENOENT", async () => {
    delete process.env['VIRTUAL_ENV']
    process.env['PATH'] = ''
    const resolved = root()
    if (!resolved.ok) throw new Error(resolved.error)
    const r = await runPytest(resolved.value, exemple.steps)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("Aucun interpréteur Python n'a été trouvé")
      expect(r.error).toContain(path.join(dir, '.venv'))
    }
  })

  // Un faux interpréteur qui répond comme un Python sans pytest. Un script à shebang ne se
  // lance pas sans shell sous Windows : le test n'a de sens qu'ailleurs.
  it.skipIf(process.platform === 'win32')("dit que pytest n'est pas installé pour l'interpréteur trouvé", async () => {
    const fake = path.join(dir, '.venv', 'bin', 'python')
    await fs.mkdir(path.dirname(fake), { recursive: true })
    await fs.writeFile(fake, `#!/bin/sh\necho "${fake}: No module named pytest" >&2\nexit 1\n`, { mode: 0o755 })
    const resolved = root()
    if (!resolved.ok) throw new Error(resolved.error)
    const r = await runPytest(resolved.value, exemple.steps)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain(`pytest n'est pas installé pour l'interpréteur ${fake}`)
      expect(r.error).toContain('-m pip install pytest')
    }
  })
})
