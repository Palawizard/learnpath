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

import { mkdtemp, mkdir, rm, writeFile, symlink, lstat, stat } from 'node:fs/promises'
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

async function importFixture(name: string): Promise<{ ok: boolean; error?: string; learn: boolean }> {
  const dir = await workspace()
  try {
    const result = await importParcours(parcours(`src/core/__fixtures__/${name}.json`), dir, {
      confirm: () => Promise.resolve(true),
      log: () => undefined,
    })
    return {
      ok: result.ok,
      ...(result.ok ? {} : { error: result.error }),
      learn: await exists(path.join(dir, '.learn')),
    }
  } finally {
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
    expect(r.error).toContain('Rien n\'a été conservé.')
    expect(r.learn).toBe(false)
  })

  it("distingue la solution qui ne passe pas ses propres tests", async () => {
    const r = await importFixture('solution-incomplete')
    expect(r.ok).toBe(false)
    expect(r.error).toContain("la solution de l'étape « 1.2 — Multiplier » ne passe pas ses propres tests")
    expect(r.error).not.toContain('casse')
    expect(r.learn).toBe(false)
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
