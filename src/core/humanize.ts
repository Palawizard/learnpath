/**
 * Traduction des formes d'erreur Vitest les plus fréquentes. Trois règles, dans cet ordre
 * d'importance :
 *
 * 1. le message brut reste **toujours** visible sous la traduction, jamais remplacé ;
 * 2. une forme non reconnue n'est ni masquée ni reformulée — on retourne `undefined` et
 *    l'affichage montre le brut, seul ;
 * 3. on ne devine jamais l'intention. Ce qui n'est pas dans le message n'est pas dit.
 *
 * Les formes viennent de `src/runner/__fixtures__/g-messages-frequents.json`, qui est une
 * vraie sortie de Vitest, pas un message écrit à la main.
 */

const RULES: readonly { readonly match: RegExp; readonly say: (m: RegExpExecArray) => string }[] = [
  {
    // Un export manquant ne dit pas « does not provide an export named » : la
    // transformation SSR le fait ressortir ici aussi. On ne tranche donc pas entre les
    // deux causes, on les nomme toutes les deux.
    // `__vite_ssr_import_1__.createPanier` : le nom tel que la transformation SSR de Vite
    // le rend dans le message.
    match: /^(?:TypeError: )?\(?0 , (?:__vite_ssr_import_\d+__\.)?([A-Za-z_$][\w$]*)\)? is not a function/m,
    say: (m) =>
      `« ${m[1]} » n'est pas une fonction : soit le module ne l'exporte pas encore, soit ce qui est exporté sous ce nom n'est pas une fonction.`,
  },
  {
    match: /^(?:TypeError: )?([\w$.]+) is not a function/m,
    say: (m) => `« ${m[1]} » n'est pas une fonction à cet endroit.`,
  },
  {
    match: /Cannot find module ['"]([^'"]+)['"]/,
    say: (m) => `Le module « ${m[1]} » est introuvable : ce fichier n'existe pas encore, ou le chemin ne correspond pas.`,
  },
  {
    match: /Cannot read properties of (undefined|null) \(reading ['"]([^'"]+)['"]\)/,
    say: (m) => `Une valeur vaut ${m[1]} là où un objet est attendu ; c'est en lisant « ${m[2]} » que ça casse.`,
  },
  {
    match: /^AssertionError: expected ([\s\S]+?) to (?:deeply equal|strictly equal|be) ([^\n]+)$/m,
    say: (m) => `Obtenu : ${m[1]}\nAttendu : ${trimNote(m[2] ?? '')}`,
  },
  {
    match: /Failed to parse source for import analysis/,
    say: () => `Le fichier n'est pas du JavaScript valide : Vitest n'a pas réussi à le lire, aucun test n'a donc été exécuté.`,
  },
  {
    // Vitest 4 perd le texte « Test timed out in Xms » dans son rapport JSON : il ne reste
    // que ce marqueur, posé par `withTimeout`. On dit ce qu'on sait, et rien de plus.
    match: /^Error: STACK_TRACE_ERROR/m,
    say: () =>
      `Le test a dépassé son délai et a été interrompu. Le rapport JSON de Vitest ne donne pas la durée ; en général une promesse n'est jamais résolue, ou un « await » manque.`,
  },
]

/**
 * Retourne une explication en français, ou `undefined` si la forme n'est pas reconnue.
 * L'appelant garde le message brut dans tous les cas.
 */
export function humanize(raw: string): string | undefined {
  const message = raw.trim()
  if (message === '') return undefined
  for (const rule of RULES) {
    const found = rule.match.exec(message)
    if (found !== null) return rule.say(found)
  }
  return undefined
}

/** `expected 1 to be 3 // Object.is equality` : le commentaire de Vitest n'apporte rien. */
function trimNote(value: string): string {
  return value.replace(/\s*\/\/.*$/, '').trim()
}
