/**
 * Diff ligne à ligne, pour deux usages (D41) : montrer ce que l'étape **ajoute** au fichier
 * plutôt que le fichier entier, et mesurer à l'import combien de lignes une étape demande.
 */

export interface DiffLine {
  readonly kind: 'same' | 'add' | 'del'
  readonly text: string
}

/**
 * Le préfixe et le suffixe communs sont retirés d'abord : une étape touche le plus souvent
 * une zone du fichier, et le reste est identique.
 *
 * ponytail: LCS en O(n×m) sur la zone du milieu. Largement suffisant pour des fichiers
 * d'exercice (quelques centaines de lignes) ; passer à Myers si un parcours en dépasse
 * quelques milliers.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before)
  const b = splitLines(after)

  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }

  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const n = midA.length
  const m = midB.length
  // lcs[i][j] : longueur de la plus longue sous-suite commune de midA[i..] et midB[j..].
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    const row = lcs[i] as number[]
    const below = lcs[i + 1] as number[]
    for (let j = m - 1; j >= 0; j--) {
      row[j] = midA[i] === midB[j] ? (below[j + 1] as number) + 1 : Math.max(below[j] as number, row[j + 1] as number)
    }
  }

  const out: DiffLine[] = a.slice(0, start).map((text) => ({ kind: 'same', text }))
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      out.push({ kind: 'same', text: midA[i] as string })
      i++
      j++
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      out.push({ kind: 'del', text: midA[i] as string })
      i++
    } else {
      out.push({ kind: 'add', text: midB[j] as string })
      j++
    }
  }
  while (i < n) out.push({ kind: 'del', text: midA[i++] as string })
  while (j < m) out.push({ kind: 'add', text: midB[j++] as string })
  for (const text of a.slice(endA)) out.push({ kind: 'same', text })
  return out
}

/**
 * Une ligne « compte » quand l'étudiant doit réellement la réfléchir. Les lignes vides et
 * celles qui ne font que fermer un bloc (`}`, `)}`, `</tr>`) ne comptent pas : sans ça, un
 * composant JSX de dix lignes utiles en pèse vingt.
 */
export function isSignificant(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed === '') return false
  if (/^[})\];,]+$/.test(trimmed)) return false
  if (/^<\/[\w.-]*>[)};,]*$/.test(trimmed)) return false
  return true
}

/** Lignes significatives ajoutées ou modifiées de `before` à `after`. */
export function significantAdditions(before: string, after: string): number {
  return diffLines(before, after).filter((line) => line.kind === 'add' && isSignificant(line.text)).length
}

function splitLines(source: string): string[] {
  if (source === '') return []
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}
