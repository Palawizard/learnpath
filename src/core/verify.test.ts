import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { loadParcours, type Parcours } from './parcours.js'
import type { ResolvedPath } from './paths.js'
import { verifyAllRed, verifyAllGreen } from './verify.js'
import { parseResult, type RawResult } from '../runner/parse.js'
import { ok, err } from './result.js'

function fixture(name: string): RawResult {
  const r = parseResult(readFileSync(`src/runner/__fixtures__/${name}.json`, 'utf8'))
  if (!r.ok) throw new Error(`${name} : ${r.error}`)
  return r.value
}

function parcours(file: string): Parcours {
  const r = loadParcours(JSON.parse(readFileSync(file, 'utf8')))
  if (!r.ok) throw new Error(r.error.map((e) => e.message).join('\n'))
  return r.value
}

const root = '/projet' as ResolvedPath

describe('verifyAllRed', () => {
  it('accepte exemple-panier.json : les cinq étapes sont rouges avant écriture', async () => {
    const r = await verifyAllRed(parcours('examples/exemple-panier.json'), root, () =>
      Promise.resolve(ok(fixture('a-fichier-absent')))
    )
    expect(r.ok).toBe(true)
  })

  it('rejette la variante dont l\'étape 1.1 a un test tautologique, en la nommant', async () => {
    const r = await verifyAllRed(
      parcours('src/core/__fixtures__/parcours-tautologique.json'),
      root,
      () => Promise.resolve(ok(fixture('e-etape-tautologique')))
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('« 1.1 — Créer un panier vide » passe déjà')
      expect(r.error).toContain('Un test qui est vert avant l\'exercice ne teste rien.')
    }
  })

  it('nomme toutes les étapes fautives quand il y en a plusieurs', async () => {
    const r = await verifyAllRed(parcours('examples/exemple-panier.json'), root, () =>
      Promise.resolve(ok(fixture('d-tout-passe')))
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('« 1.5 — ')
  })

  // D33 : le trou que ce module avait. `b-syntaxe-invalide` est une vraie sortie Vitest où
  // les cinq fichiers échouent à la collecte : zéro test exécuté, zéro assertion. L'ancienne
  // version n'y voyait aucune étape « pass » et concluait au vert — la garantie « chaque
  // étape échoue avant écriture » passait sur un parcours dont rien ne s'exécute.
  it("rejette un parcours dont aucun test ne se collecte, au lieu de le compter rouge", async () => {
    const r = await verifyAllRed(parcours('examples/exemple-panier.json'), root, () =>
      Promise.resolve(ok(fixture('b-syntaxe-invalide')))
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("aucun test de l'étape « 1.1 — ")
      expect(r.error).toContain("n'a été collecté")
      // Aucune étape n'a été évaluée : on ne désigne pas le fichier de test.
      expect(r.error).toContain('cause indéterminée')
    }
  })

  it('remonte un échec de lancement au lieu de conclure au vert', async () => {
    const r = await verifyAllRed(parcours('examples/exemple-panier.json'), root, () =>
      Promise.resolve(err("Vitest n'a produit aucun rapport."))
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/n'a pas pu être faite/)
  })
})

// --- verifyAllGreen : vrais runs Vitest, pas de fixture de sortie ---------------------------
//
// Ces tests lancent réellement Vitest dans un workspace temporaire (une dizaine de secondes
// au total). C'est le seul moyen de vérifier ce qu'on cherche : qu'une solution qui écrase
// le travail des étapes précédentes est bien vue comme telle. Une fausse sortie de Vitest
// ne prouverait que la mise en forme du message.

import { mkdtemp, mkdir, rm, writeFile, readFile, symlink, lstat, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { importParcours } from './importer.js'

/** Projet vide, avec les dépendances du dépôt reliées : Vitest doit être résoluble. */
async function workspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'learnpath-test-'))
  await writeFile(path.join(dir, 'package.json'), '{ "name": "bac-a-sable", "private": true, "type": "module" }\n')
  await mkdir(path.join(dir, 'src'), { recursive: true })
  await symlink(path.resolve('node_modules'), path.join(dir, 'node_modules'), 'junction')
  return dir
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

async function importFixture(
  name: string,
  prepare?: (dir: string) => Promise<void>,
  inspect?: (dir: string) => Promise<void>
): Promise<{ ok: boolean; error?: string }> {
  const dir = await workspace()
  if (prepare !== undefined) await prepare(dir)
  try {
    const result = await importParcours(parcours(`src/core/__fixtures__/${name}.json`), dir, {
      confirm: () => Promise.resolve(true),
      log: () => undefined,
    })
    return {
      ok: result.ok,
      ...(result.ok ? {} : { error: result.error }),
    }
  } finally {
    // Avant le nettoyage : le journal de diagnostic vit dans ce dossier.
    if (inspect !== undefined) await inspect(dir)
    await rm(dir, { recursive: true, force: true })
  }
}

describe('verifyAllGreen', { timeout: 120_000 }, () => {
  it('accepte un parcours dont les solutions cumulées passent toutes', async () => {
    const r = await importFixture('solutions-coherentes')
    expect(r.error ?? '').toBe('')
    expect(r.ok).toBe(true)
  })

  it("nomme l'étape cassée quand une solution écrase le travail des précédentes", async () => {
    const r = await importFixture('solution-regressive')
    expect(r.ok).toBe(false)
    expect(r.error).toContain("la solution de l'étape « 1.2 — Multiplier » casse l'étape « 1.1 — Additionner »")
    // D28 : le parcours reste, c'est justement le fichier que son auteur doit corriger.
    expect(r.error).toContain('Le fichier de parcours est conservé')
  })

  // Point 3c : « la solution ne passe pas ses tests » et « le fichier de test ne se
  // collecte pas » n'appellent pas la même correction. Le second ne met pas en cause la
  // solution, qui est ici parfaitement juste.
  //
  // D33 : ce parcours est maintenant refusé par `verifyAllRed`, avant même qu'on arrive aux
  // solutions — c'est le sens du point 1. Le message vient donc de là, et il ne dit plus
  // que le fichier de test est mal formé : le fichier de l'étape 1.1 se collecte, celui de
  // l'étape 1.2 non, c'est tout ce qu'on sait.
  it("refuse un parcours dont un fichier de test ne se collecte pas, sans accuser la solution", async () => {
    const r = await importFixture('test-mal-forme')
    expect(r.ok).toBe(false)
    expect(r.error).toContain("aucun test de l'étape « 1.2 — Multiplier » n'a été collecté")
    expect(r.error).toContain('la cause est dans ce fichier de test ou dans ce qu\'il importe')
    expect(r.error).not.toContain('ne passe pas ses propres tests')
    // Point 3 : la stack complète est conservée, et le message dit où.
    expect(r.error).toContain('Diagnostic complet (stack entière) : .learn/verify.log')
  })

  it("distingue la solution qui ne passe pas ses propres tests", async () => {
    const r = await importFixture('solution-incomplete')
    expect(r.ok).toBe(false)
    expect(r.error).toContain("la solution de l'étape « 1.2 — Multiplier » ne passe pas ses propres tests")
    expect(r.error).not.toContain('casse')
  })
})

// --- D33 : le diagnostic est conservé, pas détruit -----------------------------------------
//
// Le message d'erreur ne porte que la première ligne. Ce qui a fait chercher au mauvais
// endroit trois fois de suite, c'est que le reste était jeté. Il doit survivre — y compris
// au rollback, qui supprime `.learn/` quand le dossier n'existait pas avant l'import.

describe('journal de diagnostic (D33)', { timeout: 120_000 }, () => {
  it("écrit la stack complète sous .learn/, et le rollback ne l'emporte pas", async () => {
    let journal: string | undefined
    const r = await importFixture('test-mal-forme', undefined, async (dir) => {
      journal = await readFile(path.join(dir, '.learn', 'verify.log'), 'utf8').catch(() => undefined)
    })

    expect(r.ok).toBe(false)
    expect(journal).toBeDefined()
    // Plus que la première ligne : c'est tout l'intérêt.
    expect((journal ?? '').split('\n').length).toBeGreaterThan(3)
    expect(journal).toContain('1.2 — Multiplier')
    expect(journal).toContain('invalid JS syntax')
  })
})

// --- D31 : la config générée hérite de la config Vite du projet ---------------------------
//
// Vrai run Vitest : un alias déclaré dans le `vite.config.ts` du projet doit résoudre dans
// les tests du parcours. C'est ce que la config autonome du lot 2 ne savait pas faire, et
// c'est la même mécanique qui apporte @vitejs/plugin-react et jsdom à un projet React.

describe("héritage de la config Vite du projet (D31)", { timeout: 120_000 }, () => {
  const aliasConfig = [
    "import { fileURLToPath } from 'node:url'",
    'export default {',
    "  resolve: { alias: { '@lib': fileURLToPath(new URL('./src', import.meta.url)) } },",
    '}',
  ].join('\n')

  it("résout un alias du projet dans les tests du parcours", async () => {
    const r = await importFixture('alias-vite', (dir) =>
      writeFile(path.join(dir, 'vite.config.ts'), aliasConfig)
    )
    expect(r.error ?? '').toBe('')
    expect(r.ok).toBe(true)
  })

  it("sans la config du projet, le même parcours ne résout rien : l'héritage n'est pas décoratif", async () => {
    const r = await importFixture('alias-vite')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('@lib/calc.js')
  })
})

// --- Non-régression : le bac à sable n'ouvre pas node_modules en écriture (D25) ------------
//
// Vite écrit deux choses **à la racine de `node_modules`** : son cache (`.vite/`, réglé par
// `cacheDir`) et la version transpilée du fichier de config (`.vite-temp/`, imposé par
// `findNearestNodeModules`, non configurable). Si le bac à sable reliait `node_modules` d'un
// seul lien, ces écritures atterriraient dans le projet de l'utilisateur, hors de `.learn/`.
// On n'a donc besoin d'aucun vrai run : on regarde ce que le bac à sable expose.

describe('bac à sable de verifyAllGreen', () => {
  it("relie node_modules entrée par entrée : une écriture n'atteint pas le projet", async () => {
    const dir = await workspace()
    let isLink: boolean | undefined
    let leaked: boolean | undefined
    try {
      await verifyAllGreen(parcours('src/core/__fixtures__/solutions-coherentes.json'), dir as ResolvedPath, {
        // Le bac à sable est supprimé au retour de `verifyAllGreen` : on l'inspecte ici.
        execute: async (sandbox) => {
          isLink = (await lstat(path.join(sandbox, 'node_modules'))).isSymbolicLink()
          // Nom unique : le node_modules du dépôt est partagé par tous les tests.
          const sonde = `.sonde-learnpath-${process.pid}-${Date.now()}`
          await writeFile(path.join(sandbox, 'node_modules', sonde), '')
          leaked = await exists(path.join(dir, 'node_modules', sonde))
          return err('assez vu')
        },
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
    expect(isLink).toBe(false)
    expect(leaked).toBe(false)
  })
})
