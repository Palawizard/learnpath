import type { State } from '../runner/classify.js'

/**
 * Traduction des formes d'erreur Vitest les plus fréquentes. Trois règles, dans cet ordre
 * d'importance :
 *
 * 1. le message brut reste **toujours** visible sous la traduction, jamais remplacé ;
 * 2. une forme non reconnue n'est ni masquée ni reformulée — on retourne `undefined` et
 *    l'affichage montre le brut, seul ;
 * 3. on ne devine jamais l'intention. Ce qui n'est pas dans le message n'est pas dit ;
 * 4. **la même forme brute ne veut pas dire la même chose selon la phase** (D32). « Cannot
 *    read properties of undefined » pendant l'exécution d'un test parle du code de
 *    l'étudiant ; à la collecte, il parle de l'outillage — traduire enverrait chercher au
 *    mauvais endroit. Chaque règle déclare donc les phases où elle s'applique, et dans le
 *    doute on ne traduit pas.
 *
 * Les formes viennent de `src/runner/__fixtures__/g-messages-frequents.json`, qui est une
 * vraie sortie de Vitest, pas un message écrit à la main.
 */

/**
 * `collect` : Vitest lit le fichier de test et enregistre les tests. Une erreur ici vient
 * du fichier de test, de la config ou de l'outillage — aucun test n'a tourné.
 * `run` : un test s'exécute. Une erreur ici parle du code testé.
 */
export type Phase = 'collect' | 'run'

/** La phase se lit dans la classification : seule une assertion vient de l'exécution. */
export function phaseOf(state: State): Phase {
  return state === 'assertion-failed' ? 'run' : 'collect'
}

interface Rule {
  readonly match: RegExp
  readonly say: (m: RegExpExecArray) => string
  /** Phases où cette forme a le sens qu'on lui donne. Ailleurs, on laisse le brut. */
  readonly phases: readonly Phase[]
}

const RULES: readonly Rule[] = [
  {
    // Un export manquant ne dit pas « does not provide an export named » : la
    // transformation SSR le fait ressortir ici aussi. On ne tranche donc pas entre les
    // deux causes, on les nomme toutes les deux.
    // `__vite_ssr_import_1__.createPanier` : le nom tel que la transformation SSR de Vite
    // le rend dans le message.
    match: /^(?:TypeError: )?\(?0 , (?:__vite_ssr_import_\d+__\.)?([A-Za-z_$][\w$]*)\)? is not a function/m,
    say: (m) =>
      `« ${m[1]} » n'est pas une fonction : soit le module ne l'exporte pas encore, soit ce qui est exporté sous ce nom n'est pas une fonction.`,
    phases: ['run'],
  },
  {
    match: /^(?:TypeError: )?([\w$.]+) is not a function/m,
    say: (m) => `« ${m[1]} » n'est pas une fonction à cet endroit.`,
    phases: ['run'],
  },
  {
    match: /Cannot find module ['"]([^'"]+)['"]/,
    say: (m) => `Le module « ${m[1]} » est introuvable : ce fichier n'existe pas encore, ou le chemin ne correspond pas.`,
    phases: ['collect', 'run'],
  },
  {
    match: /Cannot read properties of (undefined|null) \(reading ['"]([^'"]+)['"]\)/,
    say: (m) => `Une valeur vaut ${m[1]} là où un objet est attendu ; c'est en lisant « ${m[2]} » que ça casse.`,
    phases: ['run'],
  },
  {
    match: /^AssertionError: expected ([\s\S]+?) to (?:deeply equal|strictly equal|be) ([^\n]+)$/m,
    say: (m) => `Obtenu : ${m[1]}\nAttendu : ${trimNote(m[2] ?? '')}`,
    phases: ['run'],
  },
  {
    // Vitest ne trouve pas de suite courante quand `it()` est appelé hors de tout
    // `describe()`, ou quand le callback d'un `describe()` est `async` : le fichier ne se
    // collecte pas. Le message brut parle d'un bug de Vitest, ce qui envoie l'utilisateur
    // dans le mur.
    match: /failed to find the current suite/i,
    say: () =>
      `Ce fichier de test est mal formé : un it() se trouve en dehors d'un describe(), ou le callback d'un describe() est asynchrone. Aucun test n'a été collecté, donc aucun n'a été exécuté.`,
    phases: ['collect'],
  },
  {
    match: /Failed to parse source for import analysis/,
    say: () => `Le fichier n'est pas du JavaScript valide : Vitest n'a pas réussi à le lire, aucun test n'a donc été exécuté.`,
    phases: ['collect'],
  },
  {
    // Vitest 4 perd le texte « Test timed out in Xms » dans son rapport JSON : il ne reste
    // que ce marqueur, posé par `withTimeout`. On dit ce qu'on sait, et rien de plus.
    match: /^Error: STACK_TRACE_ERROR/m,
    say: () =>
      `Le test a dépassé son délai et a été interrompu. Le rapport JSON de Vitest ne donne pas la durée ; en général une promesse n'est jamais résolue, ou un « await » manque.`,
    phases: ['run'],
  },

  // --- pytest (D39) : formes relevées dans `__fixtures__/pytest/` ----------------------
  {
    match: /No module named ['"]([^'"]+)['"]/,
    say: (m) =>
      `Le module Python « ${m[1]} » est introuvable : ce fichier n'existe pas encore, ou le nom importé ne correspond pas à son chemin.`,
    phases: ['collect', 'run'],
  },
  {
    match: /cannot import name ['"]([^'"]+)['"] from ['"]([^'"]+)['"]/,
    say: (m) =>
      `Le module « ${m[2]} » ne définit pas « ${m[1]} » : pas encore écrit, ou écrit sous un autre nom.`,
    phases: ['collect', 'run'],
  },
  {
    match: /^AttributeError: module ['"]([^'"]+)['"] has no attribute ['"]([^'"]+)['"]/m,
    say: (m) => `Le module « ${m[1]} » ne définit pas « ${m[2]} » : pas encore écrit, ou écrit sous un autre nom.`,
    phases: ['run'],
  },
  {
    match: /^NameError: name ['"]([^'"]+)['"] is not defined/m,
    say: (m) =>
      `« ${m[1]} » n'est défini nulle part là où il est utilisé : un nom mal orthographié, ou une variable ou une fonction qui n'existe pas encore.`,
    phases: ['run'],
  },
  {
    match: /^TypeError: ([\w.]+)\(\) missing \d+ required positional arguments?: (.+)$/m,
    say: (m) =>
      `« ${m[1]}() » a été appelée sans tous ses arguments obligatoires, il manque : ${m[2]}. Compare sa signature à celle du contrat.`,
    phases: ['run'],
  },
  {
    match: /^TypeError: ([\w.]+)\(\) takes (\d+) positional arguments? but (\d+) (?:was|were) given/m,
    say: (m) =>
      `« ${m[1]}() » accepte ${m[2]} argument(s) positionnel(s) mais en a reçu ${m[3]}. Compare sa signature à celle du contrat.`,
    phases: ['run'],
  },
  {
    match: /^TypeError: 'NoneType' object is not subscriptable/m,
    say: () =>
      `Une valeur vaut None là où on lit un élément avec [ ]. En Python, une fonction qui se termine sans « return » renvoie None.`,
    phases: ['run'],
  },
  {
    match: /^KeyError: ['"]?([^'"\n]+)['"]?$/m,
    say: (m) => `La clé « ${m[1]} » est absente du dictionnaire lu.`,
    phases: ['run'],
  },
  {
    match: /^(SyntaxError|IndentationError|TabError): ([^\n]+)$/m,
    say: (m) =>
      `Le fichier n'est pas du Python valide (${m[1]} : ${m[2]}) : il n'a pas pu être importé, aucun de ses tests n'a donc été exécuté.`,
    phases: ['collect'],
  },
]

/**
 * Retourne une explication en français, ou `undefined` si la forme n'est pas reconnue
 * **dans cette phase**. L'appelant garde le message brut dans tous les cas.
 */
export function humanize(raw: string, phase: Phase): string | undefined {
  const message = raw.trim()
  if (message === '') return undefined
  for (const rule of RULES) {
    if (!rule.phases.includes(phase)) continue
    const found = rule.match.exec(message)
    if (found !== null) return rule.say(found)
  }
  return undefined
}

/** `expected 1 to be 3 // Object.is equality` : le commentaire de Vitest n'apporte rien. */
function trimNote(value: string): string {
  return value.replace(/\s*\/\/.*$/, '').trim()
}
