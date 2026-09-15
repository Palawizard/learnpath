import { type Result, ok, err } from '../core/result.js'
import type { Assertion, RawResult, TestFile } from './parse.js'

/**
 * Rapport JUnit XML de pytest (`--junitxml`) → `RawResult`, la même structure que celle de
 * Vitest : `classify` n'a pas à savoir quel runner a tourné (D39).
 *
 * Le format est produit par pytest lui-même, pas par un humain : `<testcase>` à plat, sans
 * CDATA ni espace de noms. Un lecteur par expressions régulières suffit, et évite une
 * dépendance runtime pour lire quatre balises (règle 7 d'AGENTS.md). Comme `parseResult`,
 * rien ici ne lève : le rapport vient d'un processus qu'on peut tuer en route.
 *
 * Deux formes de `<testcase>`, vérifiées sur de vraies sorties (`__fixtures__/pytest/`) :
 * - un test : `classname` = module pointé (`.learn.tests.test_step_1_1`, suivi de la classe
 *   s'il y en a une), `name` = la fonction ;
 * - une **erreur de collecte** : `classname` vide, `name` = le module pointé, et un
 *   `<error message="collection failure">` qui porte le traceback.
 *
 * `testFiles` sert à retrouver le fichier depuis le module pointé : un nom pointé ne se
 * relit pas en chemin sans savoir où s'arrête le module. `parcours.ts` impose des noms de
 * fichier sans point, donc la correspondance est exacte.
 */
export function parseJunit(xml: string, testFiles: readonly string[]): Result<RawResult> {
  if (xml.trim() === '') return err("le rapport de test est vide : pytest n'a rien écrit")
  if (!/<testsuites?\b/.test(xml)) return err('le rapport de test est illisible (XML tronqué ou corrompu)')

  const files = new Map<string, { message: string; assertions: Assertion[] }>()
  const entry = (name: string): { message: string; assertions: Assertion[] } => {
    let found = files.get(name)
    if (found === undefined) {
      found = { message: '', assertions: [] }
      files.set(name, found)
    }
    return found
  }

  let total = 0
  for (const match of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attrs = attributes(match[1] ?? '')
    const body = match[2] ?? ''
    const classname = attrs.get('classname') ?? ''
    const name = attrs.get('name') ?? ''

    if (classname === '') {
      // Erreur de collecte : le module entier n'a pas pu être importé.
      const file = fileOf(name, testFiles)
      const error = child(body, 'error') ?? child(body, 'failure')
      entry(file.path).message = error === undefined ? '' : condense(error.text || error.message)
      continue
    }

    total += 1
    const file = fileOf(classname, testFiles)
    // Le nom sous lequel le test est connu dans son fichier : `TestAjout::test_un`.
    const inside = file.rest === '' ? name : `${file.rest.split('.').join('::')}::${name}`
    const failure = child(body, 'failure') ?? child(body, 'error')
    if (failure !== undefined) {
      entry(file.path).assertions.push({
        fullName: inside,
        status: 'failed',
        // Le message court d'abord (« AssertionError: assert … »), le traceback ensuite.
        failureMessages: [failure.message, condense(failure.text)].filter((m) => m !== ''),
      })
    } else if (child(body, 'skipped') !== undefined) {
      entry(file.path).assertions.push({ fullName: inside, status: 'skipped', failureMessages: [] })
    } else {
      entry(file.path).assertions.push({ fullName: inside, status: 'passed', failureMessages: [] })
    }
  }

  const result: TestFile[] = [...files].map(([name, file]) => ({
    name,
    status: file.message !== '' || file.assertions.some((a) => a.status === 'failed') ? 'failed' : 'passed',
    message: file.message,
    assertions: file.assertions,
  }))

  return ok({
    success: result.length > 0 && result.every((file) => file.status === 'passed'),
    numTotalTests: total,
    files: result,
    stderr: '',
  })
}

/** Chemin du fichier de test désigné par un module pointé, et ce qui suit le module. */
function fileOf(dotted: string, testFiles: readonly string[]): { path: string; rest: string } {
  for (const file of testFiles) {
    const module = file.replace(/\.py$/, '').split('/').join('.')
    // pytest préfixe le module d'un point quand le chemin commence par `.learn`.
    for (const candidate of [module, `.${module}`, module.replace(/^\./, '')]) {
      if (dotted === candidate) return { path: file, rest: '' }
      if (dotted.startsWith(`${candidate}.`)) return { path: file, rest: dotted.slice(candidate.length + 1) }
    }
  }
  return { path: dotted, rest: '' }
}

/**
 * Le traceback de pytest préfixe par `E` les lignes qui disent ce qui s'est passé ; le reste
 * est le chemin d'appel. On garde les lignes `E` quand il y en a, c'est ce qu'on affiche.
 * Le traceback entier n'est pas perdu : il est aussi dans la sortie du processus, que le
 * journal de diagnostic conserve (D33).
 */
function condense(text: string): string {
  const lines = text.split('\n').filter((line) => /^E(?: |$)/.test(line))
  if (lines.length === 0) return text.trim()
  return lines.map((line) => line.replace(/^E {0,3}/, '')).join('\n').trim()
}

interface Child {
  readonly message: string
  readonly text: string
}

function child(body: string, tag: string): Child | undefined {
  const found = new RegExp(`<${tag}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${tag}>)`).exec(body)
  if (found === null) return undefined
  return {
    message: attributes(found[1] ?? '').get('message') ?? '',
    text: decode(found[2] ?? ''),
  }
}

function attributes(source: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const match of source.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    out.set(match[1] ?? '', decode(match[2] ?? ''))
  }
  return out
}

const ENTITIES: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

function decode(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (whole, code: string) => {
    if (code.startsWith('#x')) return String.fromCodePoint(Number.parseInt(code.slice(2), 16))
    if (code.startsWith('#')) return String.fromCodePoint(Number.parseInt(code.slice(1), 10))
    return ENTITIES[code] ?? whole
  })
}
