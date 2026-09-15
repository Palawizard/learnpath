import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { type Result, ok, err } from '../core/result.js'
import { type Launch, pythonFor } from '../core/exec.js'
import type { ResolvedPath } from '../core/paths.js'
import type { Step } from '../core/parcours.js'
import type { RawResult, TestFile } from './parse.js'
import { parseJunit } from './junit.js'
import { DEFAULT_TIMEOUT_MS, detail, spawnTool } from './spawn.js'
import type { RunOptions } from './vitest.js'

export const PYTEST_CONFIG = '.learn/pytest.ini'

export interface PytestOptions extends RunOptions {
  /**
   * Racine du vrai projet, là où chercher son environnement Python. Elle diffère de `root`
   * dans le bac à sable de `verifyAllGreen`, qui ne copie pas `.venv` (D26).
   */
  readonly projectRoot?: string
}

/**
 * pytest, construit comme Vitest (D14) : l'argv vient d'ici, jamais du parcours (D39).
 *
 * - **`-c .learn/pytest.ini`** : la config de test du projet (`pytest.ini`, `pyproject.toml`,
 *   `setup.cfg`, `tox.ini`) n'est ni lue ni appliquée, et le `conftest.py` de sa racine n'est
 *   pas chargé — pytest arrête la recherche des conftest au dossier de l'ini (D3). Vérifié :
 *   un `addopts` invalide et un `conftest.py` qui lève à la racine n'empêchent rien.
 * - **les fichiers de test sont passés un par un** : pas de `-k`. Le filtre porte sur le
 *   fichier de l'étape, c'est ce qui rend les noms de test libres en Python.
 * - **`--continue-on-collection-errors`** : sans lui, une étape pas encore commencée
 *   interrompt toute la session et les étapes précédentes passent pour des régressions.
 * - **`-p no:cacheprovider` et `PYTHONDONTWRITEBYTECODE`** : ni `.pytest_cache` ni
 *   `__pycache__` à côté du code de l'utilisateur, hors de `.learn/` (règle 3, comme D25).
 * - **`--junitxml` vers un temporaire** : le rapport structuré natif de pytest, sans plugin
 *   à installer. Même raison que `--outputFile` pour Vitest : on ne lit jamais stdout.
 */
export async function runPytest(
  root: ResolvedPath,
  steps: readonly Step[],
  options: PytestOptions = {}
): Promise<Result<RawResult>> {
  const cwd = options.cwd ?? root
  const python = pythonFor([cwd, root, options.projectRoot ?? root])
  if (!python.resolved) return err(noPython(python))

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'learnpath-'))
  const report = path.join(dir, 'report.xml')
  const files = [...new Set(steps.map((step) => step.tests.file))]

  try {
    const args = [
      ...python.args,
      '-m',
      'pytest',
      '-c',
      path.relative(cwd, path.join(root, PYTEST_CONFIG)),
      `--rootdir=${root}`,
      '-p',
      'no:cacheprovider',
      '--continue-on-collection-errors',
      '-q',
      '--tb=short',
      `--junitxml=${report}`,
      ...files.map((file) => path.relative(cwd, path.join(root, file))),
    ]
    const env: NodeJS.ProcessEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1' }
    // Des options venues de l'environnement de l'utilisateur rouvriraient ce que `-c` ferme.
    delete env['PYTEST_ADDOPTS']

    const spawned = await spawnTool(python.file, args, cwd, {
      tool: 'pytest',
      captureStdout: true,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      env,
      ...(options.signal ? { signal: options.signal } : {}),
    })
    if (!spawned.ok) return spawned

    let content: string
    try {
      content = await fs.readFile(report, 'utf8')
    } catch {
      if (/No module named pytest\b/.test(spawned.value.output)) {
        return err(
          `pytest n'est pas installé pour l'interpréteur ${python.file}. Réimporte le parcours pour relancer son installation, ou installe-le toi-même : « ${python.file} -m pip install pytest ».`
        )
      }
      return err(`pytest n'a produit aucun rapport.${detail(spawned.value)}`)
    }
    const parsed = parseJunit(content, files)
    if (!parsed.ok) return err(`${parsed.error}.${detail(spawned.value)}`)
    // La sortie entière, tracebacks compris : le rapport n'en garde que les lignes `E`, le
    // journal de diagnostic a besoin du reste (D33).
    return ok({
      ...parsed.value,
      files: labelByStep(parsed.value.files, steps),
      stderr: spawned.value.output,
    })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

/**
 * `classify` reconnaît les tests d'une étape à leur nom, « step <id> » en tête — c'est le
 * filtre `-t` de Vitest. En Python, l'étape est le fichier : on préfixe donc chaque test par
 * l'étape dont il vient, et `classify` reste le même pour les deux runners.
 */
export function labelByStep(files: readonly TestFile[], steps: readonly Step[]): readonly TestFile[] {
  return files.map((file) => {
    const step = steps.find((s) => s.tests.file === file.name)
    if (step === undefined) return file
    return {
      ...file,
      assertions: file.assertions.map((a) => ({ ...a, fullName: `step ${step.id} › ${a.fullName}` })),
    }
  })
}

function noPython(launch: Launch): string {
  return [
    "Aucun interpréteur Python n'a été trouvé depuis VSCode : ni environnement virtuel dans le projet (.venv, venv), ni VIRTUAL_ENV, ni python3 ou python dans le PATH de l'hôte d'extension.",
    "Crée l'environnement du projet dans un terminal, à sa racine (« python3 -m venv .venv », puis « .venv/bin/pip install pytest », ou « .venv\\Scripts\\pip install pytest » sous Windows), puis relance.",
    '',
    'Diagnostic — chemins examinés :',
    ...launch.tried.map((candidate) => `    ${candidate}`),
  ].join('\n')
}
