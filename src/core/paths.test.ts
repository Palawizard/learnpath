import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { safeResolve } from './paths.js'

const ROOT = '/home/user/projet'
/** `safeResolve` retourne un chemin résolu : sous Windows, il porte une lettre de lecteur
 *  que la chaîne de `ROOT` n'a pas. Les attentes se comparent au root résolu. */
const RESOLVED = path.resolve(ROOT)

const HOSTILES: ReadonlyArray<readonly [string, string]> = [
  ['chemin vide', ''],
  ['espaces seulement', '   '],
  ['absolu POSIX', '/etc/passwd'],
  ['absolu POSIX vers le root lui-meme', '/home/user/projet/src/a.js'],
  ['absolu Windows lettre de lecteur', 'C:\\Windows\\System32\\cmd.exe'],
  ['absolu Windows slash avant', 'C:/Windows/System32'],
  ['Windows relatif au lecteur', 'C:src/a.js'],
  ['Windows lettre minuscule', 'd:/tmp/x'],
  ['UNC Windows', '\\\\serveur\\partage\\x'],
  ['antislash simple', 'src\\a.js'],
  ['remontee directe', '../secret'],
  ['remontee au milieu', 'src/../../secret'],
  ['remontee finale', 'src/sous/..'],
  ['remontee seule', '..'],
  ['remontee avec point courant', './../secret'],
  ['remontee neutralisee en apparence', 'src/./../../etc/passwd'],
  ['remontee repetee', '../../../../../../etc/passwd'],
  ['octet nul', 'src/a.js\u0000.txt'],
  ['octet nul seul', '\u0000'],
  ['saut de ligne', 'src/a\n.js'],
  ['antislash de remontee Windows', '..\\..\\secret'],
]

describe('safeResolve — cas hostiles', () => {
  for (const [nom, candidat] of HOSTILES) {
    it(`rejette : ${nom} (${JSON.stringify(candidat)})`, () => {
      const r = safeResolve(ROOT, candidat)
      expect(r.ok, `${nom} aurait dû être rejeté`).toBe(false)
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0)
    })
  }

  it('rejette un chemin qui sort du root sans utiliser ".."', () => {
    // 'projet-autre' commence par la chaîne du root : un startsWith naïf laisserait passer.
    const r = safeResolve('/home/user/projet', '../projet-autre/x')
    expect(r.ok).toBe(false)
  })

  it('ne se laisse pas duper par un root non normalisé', () => {
    const r = safeResolve('/home/user/projet/./sous/..', '../secret')
    expect(r.ok).toBe(false)
  })
})

describe('safeResolve — cas valides', () => {
  const VALIDES = [
    'src/a.js',
    '.learn/tests/step-1.1.spec.js',
    './src/a.js',
    'a.js',
    'src/sous/dossier/fichier.test.ts',
    'src/mon..fichier.js',
    'src/..cache/a.js',
  ]

  for (const candidat of VALIDES) {
    it(`accepte ${candidat}`, () => {
      const r = safeResolve(ROOT, candidat)
      expect(r.ok, `${candidat} aurait dû être accepté`).toBe(true)
      if (r.ok) {
        expect(path.isAbsolute(r.value)).toBe(true)
        expect(r.value.startsWith(RESOLVED + path.sep)).toBe(true)
      }
    })
  }

  it('retourne un chemin normalisé', () => {
    const r = safeResolve(ROOT, './src/./a.js')
    expect(r).toEqual({ ok: true, value: path.join(RESOLVED, 'src', 'a.js') })
  })
})

describe('allowRoot', () => {
  it('refuse la racine par défaut', () => {
    expect(safeResolve(ROOT, '.').ok).toBe(false)
  })

  it('accepte « . » quand allowRoot est demandé, pour runner.cwd', () => {
    const r = safeResolve(ROOT, '.', { allowRoot: true })
    expect(r).toEqual({ ok: true, value: RESOLVED })
  })

  it('n\'assouplit rien d\'autre : « .. » reste refusé même avec allowRoot', () => {
    expect(safeResolve(ROOT, '..', { allowRoot: true }).ok).toBe(false)
    expect(safeResolve(ROOT, 'src/../..', { allowRoot: true }).ok).toBe(false)
    expect(safeResolve(ROOT, '/etc/passwd', { allowRoot: true }).ok).toBe(false)
  })
})
