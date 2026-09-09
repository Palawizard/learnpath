import MarkdownIt from 'markdown-it'

/**
 * `explanation` vient d'un LLM et finit dans une webview : c'est une chaîne hostile.
 * markdown-it est configuré pour ne *pas produire* de HTML dangereux, plutôt que pour
 * en produire puis le nettoyer :
 *
 * - `html: false` : le HTML brut du source n'est pas parsé, il est échappé et sort en
 *   texte. `<script>` ne peut donc pas exister dans la sortie.
 * - la règle `image` est désactivée : la CSP interdit toute image de toute façon
 *   (`default-src 'none'`), autant que `![x](data:…)` reste du texte visible plutôt
 *   qu'une balise cassée.
 * - `validateLink` n'autorise que http, https et mailto : `javascript:` et `data:` font
 *   retomber le lien en texte simple.
 */
const md = new MarkdownIt({ html: false, linkify: false, breaks: false })
md.disable(['image'])
md.validateLink = (url) => /^(https?:\/\/|mailto:)/i.test(url.trim())

export function renderMarkdown(source: string): string {
  return md.render(source)
}
