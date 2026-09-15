import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseJunit } from './junit.js'

/** Rapports JUnit **réels** de pytest, voir __fixtures__/pytest/README.md. */
const fixture = (name: string): string =>
  readFileSync(`src/runner/__fixtures__/pytest/${name}.xml`, 'utf8')

const FILES = ['1_1', '1_2', '1_3', '1_4', '1_5'].map((n) => `.learn/tests/test_step_${n}.py`)

describe('parseJunit sur les sorties pytest réelles', () => {
  it("lit un rapport où aucun module de test n'a pu être importé", () => {
    const r = parseJunit(fixture('a-fichier-absent'), FILES)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.success).toBe(false)
    expect(r.value.numTotalTests).toBe(0)
    expect(r.value.files.map((f) => f.name)).toEqual(FILES)
    expect(r.value.files.every((f) => f.status === 'failed' && f.assertions.length === 0)).toBe(true)
    // Les lignes `E` seulement : le chemin d'appel dans importlib n'aide personne.
    expect(r.value.files[0]?.message).toBe("ModuleNotFoundError: No module named 'panier'")
  })

  it("garde l'extrait de code et le curseur d'une erreur de syntaxe", () => {
    const r = parseJunit(fixture('b-syntaxe-invalide'), FILES)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const message = r.value.files[0]?.message ?? ''
    expect(message).toContain('def creer_panier(:')
    expect(message).toContain('SyntaxError: invalid syntax')
    expect(message).not.toContain('importlib')
  })

  it("lit les tests, leur statut et le message court de l'échec", () => {
    const r = parseJunit(fixture('c-assertion-echouee'), FILES)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const assertions = r.value.files.flatMap((f) => f.assertions)
    expect(assertions.map((a) => [a.fullName, a.status])).toEqual([
      ['test_lignes_vides_et_aucune_promo', 'failed'],
      ['test_nouvel_objet_a_chaque_appel', 'passed'],
    ])
    expect(assertions[0]?.failureMessages[0]).toContain('assert [1] == []')
    expect(r.value.numTotalTests).toBe(2)
  })

  it('lit un rapport entièrement vert, fichier par fichier', () => {
    const r = parseJunit(fixture('d-tout-passe'), FILES)
    expect(r.ok && r.value.success).toBe(true)
    if (!r.ok) return
    expect(r.value.numTotalTests).toBe(15)
    expect(r.value.files.map((f) => [f.name, f.assertions.length])).toEqual([
      [FILES[0], 2],
      [FILES[1], 3],
      [FILES[2], 3],
      [FILES[3], 2],
      [FILES[4], 5],
    ])
  })

  it('sépare dans un même run un module qui ne se collecte pas et un module qui passe', () => {
    const r = parseJunit(fixture('e-nom-pas-encore-ecrit'), FILES)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [un, deux] = [FILES[0], FILES[1]].map((name) => r.value.files.find((f) => f.name === name))
    expect(un?.status).toBe('passed')
    expect(un?.assertions.every((a) => a.status === 'passed')).toBe(true)
    expect(deux?.status).toBe('failed')
    expect(deux?.message).toContain("cannot import name 'ajouter_article' from 'panier'")
  })

  it('décode les entités XML des messages', () => {
    const r = parseJunit(fixture('g-messages-frequents'), ['.learn/tests/test_step_2_1.py'])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const egalite = r.value.files[0]?.assertions.find((a) => a.fullName === 'test_egalite')
    expect(egalite?.failureMessages[0]).toContain("{'promo': None} != {'promo': 'X'}")
    expect(egalite?.failureMessages[0]).not.toContain('&#10;')
  })

  it('rattache une méthode de classe à son fichier, et la nomme Classe::méthode', () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?><testsuites><testsuite name="pytest"><testcase classname=".learn.tests.test_step_1_2.TestAjout" name="test_un" time="0.000" /></testsuite></testsuites>'
    const r = parseJunit(xml, FILES)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.files[0]?.name).toBe(FILES[1])
    expect(r.value.files[0]?.assertions[0]?.fullName).toBe('TestAjout::test_un')
  })
})

describe('parseJunit ne lève jamais', () => {
  const cas: ReadonlyArray<readonly [string, string, RegExp]> = [
    ['rapport vide', '', /vide/],
    ['espaces seulement', '  \n', /vide/],
    ['pas du JUnit', '{"success": true}', /illisible/],
  ]
  for (const [nom, contenu, attendu] of cas) {
    it(`retourne une erreur lisible : ${nom}`, () => {
      const r = parseJunit(contenu, FILES)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(attendu)
    })
  }

  it('accepte un rapport tronqué en ne gardant que les tests complets', () => {
    const xml = fixture('d-tout-passe')
    const r = parseJunit(xml.slice(0, Math.floor(xml.length / 2)), FILES)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.numTotalTests).toBeLessThan(15)
  })

  it("ne déclare pas vert un rapport sans aucun test", () => {
    const r = parseJunit('<testsuites><testsuite name="pytest" tests="0" /></testsuites>', FILES)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.success).toBe(false)
  })
})
