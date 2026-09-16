import { describe, expect, it } from 'vitest'
import { diffLines, isSignificant, significantAdditions } from './diff.js'

function kinds(before: string, after: string): string {
  return diffLines(before, after)
    .map((line) => `${line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}${line.text}`)
    .join('\n')
}

describe('diffLines', () => {
  it('un fichier neuf est entièrement ajouté', () => {
    expect(kinds('', 'a\nb\n')).toBe('+a\n+b')
  })

  it('garde les lignes communes et isole l’ajout au milieu', () => {
    expect(kinds('a\nc\n', 'a\nb\nc\n')).toBe(' a\n+b\n c')
  })

  it('distingue une ligne modifiée (retirée puis ajoutée)', () => {
    expect(kinds('a\nx\nc', 'a\ny\nc')).toBe(' a\n-x\n+y\n c')
  })

  it('ignore la différence de fins de ligne Windows', () => {
    expect(kinds('a\r\nb\r\n', 'a\nb\n')).toBe(' a\n b')
  })

  it('retrouve les lignes communes dispersées', () => {
    const out = diffLines('a\nb\nc\nd', 'a\nX\nc\nY\nd')
    expect(out.filter((l) => l.kind === 'same').map((l) => l.text)).toEqual(['a', 'c', 'd'])
  })
})

describe('isSignificant', () => {
  it.each(['', '   ', '}', '  })', ');', '</tr>', '  </tbody>', ']'])('« %s » ne compte pas', (line) => {
    expect(isSignificant(line)).toBe(false)
  })

  it.each(['return x', '<td>{a}</td>', 'if (a) {', '} else {'])('« %s » compte', (line) => {
    expect(isSignificant(line)).toBe(true)
  })
})

describe('significantAdditions', () => {
  it('compte seulement les lignes ajoutées utiles', () => {
    const before = 'export function a() {\n  return 1\n}\n'
    const after = 'export function a() {\n  return 1\n}\n\nexport function b() {\n  return 2\n}\n'
    expect(significantAdditions(before, after)).toBe(2)
  })
})
