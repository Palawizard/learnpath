import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { loadParcours, type ValidationError } from './parcours.js'

const REPO = path.resolve(__dirname, '..', '..')

function lire(relatif: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(REPO, relatif), 'utf8'))
}

function fixture(nom: string): unknown {
  return lire(path.join('src', 'core', '__fixtures__', nom))
}

function messages(errors: readonly ValidationError[]): string {
  return errors.map((e) => e.message).join('\n')
}

describe('loadParcours — cas nominal', () => {
  it("accepte examples/exemple-panier.json", () => {
    const r = loadParcours(lire('examples/exemple-panier.json'))
    if (!r.ok) throw new Error(`refusé à tort :\n${messages(r.error)}`)
    expect(r.value.slug).toBe('panier')
    expect(r.value.steps).toHaveLength(5)
    expect(r.value.runner.kind).toBe('vitest')
  })
})

describe('loadParcours — fixtures cassées', () => {
  const CAS: ReadonlyArray<readonly [string, string, RegExp]> = [
    ['runner manquant', 'sans-runner.json', /« runner » est obligatoire et absent de la racine du parcours/],
    ['ids dupliqués', 'ids-dupliques.json', /Étape 1\.2 : cet identifiant est déjà utilisé par l'étape n°2/],
    ['tests.file avec ..', 'test-file-remontee.json', /Étape 1\.2, tests\.file : le chemin remonte hors du projet avec « \.\. »/],
    ['chemin absolu', 'chemin-absolu.json', /Étape 1\.1, expected\.files : le chemin est absolu/],
    ['setup avec &&', 'setup-avec-and.json', /Runner, setup\[0\] : la commande contient le métacaractère shell « & »/],
    ['solution hors expected.files', 'solution-hors-expected.json', /Étape 1\.4 : la solution écrit « src\/autre\.js », qui n'est pas listé dans expected\.files/],
    ['zéro étape', 'zero-etape.json', /le parcours ne contient aucune étape, il en faut entre 1 et 20/],
    ['25 étapes', 'vingt-cinq-etapes.json', /le parcours contient trop d'étapes, le maximum est 20/],
  ]

  for (const [nom, fichier, attendu] of CAS) {
    it(`refuse : ${nom}`, () => {
      const r = loadParcours(fixture(fichier))
      expect(r.ok, `${nom} aurait dû être refusé`).toBe(false)
      if (!r.ok) expect(messages(r.error)).toMatch(attendu)
    })
  }
})

/** Vue mutable et partielle du parcours, juste ce que les mutations ci-dessous touchent. */
interface ParcoursBrut {
  version: number
  slug: string
  runner: { kind: string; cwd?: string; setup?: string[]; command?: string }
  steps: Array<{
    tests: { grep: string; file: string }
    expected: { files: string[] }
    scaffold?: Record<string, string>
    solution: Record<string, string>
    examples?: Array<{ title: string; code?: string }>
    bonus?: string
  }>
}

function etape(p: ParcoursBrut, i: number): ParcoursBrut['steps'][number] {
  const s = p.steps[i]
  if (!s) throw new Error(`étape n°${i} absente de la fixture`)
  return s
}

describe('loadParcours — messages exploitables', () => {
  const nominal = () => lire('examples/exemple-panier.json') as ParcoursBrut

  function casse(mutation: (p: ParcoursBrut) => void): string {
    const p = nominal()
    mutation(p)
    const r = loadParcours(p)
    if (r.ok) throw new Error('le parcours aurait dû être refusé')
    return messages(r.error)
  }

  it('nomme l’étape et le champ pour un grep vide', () => {
    expect(casse((p) => (etape(p, 2).tests.grep = ''))).toMatch(
      /Étape 1\.3 : le champ tests\.grep est vide/
    )
  })

  it('explique un grep incohérent avec l’id', () => {
    expect(casse((p) => (etape(p, 2).tests.grep = 'step 9.9'))).toMatch(
      /Étape 1\.3 : le champ tests\.grep vaut « step 9\.9 » mais doit contenir « step 1\.3 »/
    )
  })

  it('refuse un fichier de test hors de .learn/tests/', () => {
    expect(casse((p) => (etape(p, 0).tests.file = 'tests/step-1.1.spec.js'))).toMatch(
      /Étape 1\.1 : le fichier de test « tests\/step-1\.1\.spec\.js » doit être placé dans \.learn\/tests\//
    )
  })

  it('refuse expected.files vide', () => {
    expect(casse((p) => (etape(p, 0).expected.files = []))).toMatch(
      /Étape 1\.1 : le champ « expected\.files » doit contenir au moins 1 élément/
    )
  })

  it('refuse un slug qui n’est pas en kebab-case', () => {
    expect(casse((p) => (p.slug = 'Mon Panier'))).toMatch(/kebab-case/)
  })

  it('refuse une version autre que 1', () => {
    expect(casse((p) => (p.version = 2))).toMatch(/« version » doit valoir exactement 1/)
  })

  it('refuse un champ inconnu', () => {
    expect(casse((p) => (etape(p, 0).bonus = 'oups'))).toMatch(
      /Étape 1\.1 : le champ « bonus » n'existe pas dans le format v1/
    )
  })

  it('refuse une commande de setup hors liste blanche', () => {
    expect(casse((p) => (p.runner.setup = ['bash install.sh']))).toMatch(
      /Runner, setup\[0\] : la commande doit commencer par npm, npx, pnpm, yarn/
    )
  })

  it('refuse un runner qui porte encore command et filterFlag', () => {
    expect(casse((p) => (p.runner.command = 'npx vitest run'))).toMatch(
      /le champ « command » n'existe pas dans le format v1/
    )
  })

  it('refuse un cwd qui sort du projet', () => {
    expect(casse((p) => (p.runner.cwd = '../ailleurs'))).toMatch(
      /Runner, champ cwd : le chemin remonte hors du projet/
    )
  })

  it('refuse un squelette sur un fichier non déclaré par l’étape', () => {
    expect(casse((p) => (etape(p, 1).scaffold = { 'src/autre.js': '// TODO' }))).toMatch(
      /Étape 1\.2 : le squelette porte sur « src\/autre\.js », qui n'est pas listé dans expected\.files/
    )
  })

  it('refuse un squelette identique à la solution', () => {
    expect(
      casse((p) => (etape(p, 1).scaffold = { 'src/panier.js': etape(p, 1).solution['src/panier.js'] ?? '' }))
    ).toMatch(/Étape 1\.2 : le squelette de « src\/panier\.js » est identique à la solution/)
  })

  it('refuse un exemple sans code', () => {
    expect(casse((p) => (etape(p, 0).examples = [{ title: 'vide' }]))).toMatch(
      /Étape 1\.1 : le champ « code » est obligatoire/
    )
  })

  it('accepte cwd « . »', () => {
    const r = loadParcours(nominal())
    expect(r.ok).toBe(true)
  })

  it('refuse autre chose qu’un objet', () => {
    for (const valeur of [null, 42, 'un parcours', []]) {
      expect(loadParcours(valeur).ok, JSON.stringify(valeur)).toBe(false)
    }
  })
})
