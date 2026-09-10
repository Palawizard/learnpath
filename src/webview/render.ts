import type {
  RecapStepView,
  RedoView,
  RegressionView,
  ReviewView,
  SolutionFileView,
  StatusView,
  ViewModel,
} from '../core/viewmodel.js'
import { renderMarkdown } from './markdown.js'

/**
 * Rendu du view model en HTML. Aucun import `vscode` : c'est ce qui rend le panneau
 * testable. Deux fragments plutôt qu'une page entière, parce que la zone d'état est une
 * région `aria-live` — la remplacer élément compris, c'est perdre l'annonce.
 */

export function renderMain(model: ViewModel): string {
  // Fin de parcours : l'énoncé de la dernière étape n'intéresse plus personne, et le
  // laisser au-dessus du récapitulatif donne un écran de fin qui ressemble à une étape.
  if (model.finished) return [renderRecap(model.recap), renderReviewEntry(model)].join('\n')

  return [
    // La relecture s'annonce avant l'énoncé : on doit savoir qu'on lit une étape passée
    // avant de lire quoi que ce soit d'autre.
    model.readOnly ? renderReviewNotice(model) : '',
    `<h2 class="step-title">${escapeHtml(model.stepTitle)}</h2>`,
    `<div class="explanation">${renderMarkdown(model.explanation)}</div>`,
    renderExpected(model),
    renderHints(model),
    renderSolution(model),
    model.review === undefined ? renderActions(model) : renderReviewActions(model.review),
    model.review === undefined ? '' : renderRedo(model.review.redo),
  ]
    .filter((block) => block !== '')
    .join('\n')
}

export function renderStatus(model: ViewModel): string {
  // Pendant un run, ce qui est affiché date de la tentative précédente : `stale` le grise
  // pour qu'on ne lise pas un rouge périmé comme un rouge à jour.
  const stale = model.running ? ' stale' : ''
  return [
    model.running ? '<p class="running">Tests en cours…</p>' : '',
    renderRegressions(model.regressions, stale),
    renderStatusZone(model.status, stale),
  ]
    .filter((block) => block !== '')
    .join('\n')
}

export function renderHeader(model: ViewModel): string {
  const counter = model.readOnly
    ? `Relecture — étape ${model.position} / ${model.total}`
    : model.finished
      ? `Parcours terminé — ${model.total} étapes`
      : `Étape ${model.position} / ${model.total}`
  // Un segment par étape, pas une jauge continue : « Étape 5 / 5 » avec une barre aux
  // quatre cinquièmes se lisait comme une incohérence. Ici les deux comptent la même
  // chose — quatre segments acquis, le cinquième en cours.
  // `currentPosition` et non `position` : en relecture, la barre continue de montrer où en
  // est le parcours, pas où en est la lecture.
  const segments = Array.from({ length: model.total }, (_, i) => {
    const done = model.finished || i < model.currentPosition - 1
    const current = !model.finished && i === model.currentPosition - 1
    return `<span class="segment${done ? ' done' : current ? ' current' : ''}"></span>`
  }).join('')

  return [
    `<h1>${escapeHtml(model.parcoursTitle)}</h1>`,
    `<p class="counter">${escapeHtml(counter)}</p>`,
    `<div class="bar" role="progressbar" aria-label="Progression du parcours"`,
    ` aria-valuemin="0" aria-valuemax="100" aria-valuenow="${model.percent}">`,
    `${segments}</div>`,
  ].join('')
}

/**
 * État d'accueil : la vue est visible dès l'icône de la barre d'activité, y compris dans un
 * projet sans parcours. Elle dit en deux lignes ce que fait l'extension, donne le bouton
 * d'import et le bouton qui compose le prompt de génération — les trois choses qui
 * n'existaient qu'en connaissant le nom d'une commande de la palette.
 */
export function renderWelcome(): string {
  return [
    `<h2>Aucun parcours dans ce projet</h2>`,
    `<p>LearnPath joue un parcours d’apprentissage dans ton propre projet : tu écris le `,
    `code toi-même, les tests de l’étape tournent à chaque sauvegarde et le parcours `,
    `avance quand ils passent.</p>`,
    `<p>Le parcours est un fichier JSON produit en amont par ton agent de code : `,
    `l’extension n’appelle aucun modèle et ne fait aucun appel réseau.</p>`,
    `<div class="actions">`,
    `<button type="button" data-action="generatePrompt">Générer le prompt</button>`,
    `<button type="button" class="secondary" data-action="import">Importer un parcours</button>`,
    `</div>`,
    `<p class="muted">Le prompt est composé par l’extension à partir de ce que tu veux `,
    `coder : plus rien à recopier depuis la documentation.</p>`,
  ].join('')
}

// --- Blocs -----------------------------------------------------------------------------

function renderExpected(model: ViewModel): string {
  const parts = [
    `<h3>Attendu</h3>`,
    model.expectedFiles.map((file) => `<code class="file">${escapeHtml(file)}</code>`).join(' '),
  ]
  if (model.contract !== undefined) {
    parts.push(`<pre class="contract">${escapeHtml(model.contract)}</pre>`)
  }
  if (model.acceptance.length > 0) {
    parts.push(
      `<ul class="acceptance">${model.acceptance.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`
    )
  }
  return `<section class="card expected">${parts.join('\n')}</section>`
}

function renderHints(model: ViewModel): string {
  if (model.hints.length === 0) return ''
  const items = model.hints
    .map((hint, i) => `<li><span class="hint-index">${i + 1}.</span> ${escapeHtml(hint)}</li>`)
    .join('')
  return `<section class="card hints"><h3>Indices</h3><ol class="hint-list">${items}</ol></section>`
}

/**
 * La solution s'affiche, elle ne s'écrit plus (D34). Un bloc par fichier, chemin en
 * en-tête : une étape qui touche trois fichiers doit se lire comme trois fichiers, pas
 * comme un pavé qu'il faut redécouper soi-même. La copie passe par l'extension plutôt que
 * par `navigator.clipboard` : le presse-papiers de l'hôte marche partout, y compris là où
 * la webview n'a pas la permission.
 */
function renderSolution(model: ViewModel): string {
  if (model.solution.length === 0) return ''
  const blocks = model.solution.map(renderSolutionFile).join('')
  return [
    `<section class="card solution"><h3>Solution</h3>`,
    `<p class="muted">À recopier toi-même : rien n'a été écrit dans tes fichiers.</p>`,
    blocks,
    `</section>`,
  ].join('')
}

function renderSolutionFile(file: SolutionFileView): string {
  return [
    `<div class="solution-file">`,
    `<div class="solution-head">`,
    `<code class="file">${escapeHtml(file.file)}</code>`,
    `<button type="button" class="secondary" data-action="copy"`,
    ` data-file="${escapeHtml(file.file)}">Copier</button>`,
    `</div>`,
    `<pre class="code"><code>${highlight(file.file, file.content)}</code></pre>`,
    `</div>`,
  ].join('')
}

function renderActions(model: ViewModel): string {
  if (model.finished) return ''
  const hintLabel =
    model.hintsRemaining > 0
      ? `Indice (${model.hintsRemaining} restant${model.hintsRemaining > 1 ? 's' : ''})`
      : 'Plus d’indice'
  const solutionLabel = model.solutionRevealed ? 'Solution affichée' : 'Solution'
  return [
    `<div class="actions">`,
    `<button type="button" data-action="hint"${model.hintsRemaining > 0 ? '' : ' disabled'}>${escapeHtml(hintLabel)}</button>`,
    `<button type="button" class="secondary" data-action="solution"${model.solutionRevealed ? ' disabled' : ''}>${escapeHtml(solutionLabel)}</button>`,
    `</div>`,
    renderReviewEntry(model),
  ].join('')
}

/**
 * Entrée de la relecture. Un lien discret, jamais dans la même rangée que les actions de
 * l'étape : relire ne fait rien, et ne doit pas se cliquer par réflexe.
 */
function renderReviewEntry(model: ViewModel): string {
  if (model.reviewEntry === undefined) return ''
  return [
    `<p class="muted review-entry">`,
    `<button type="button" class="link" data-action="review" data-step="${escapeHtml(model.reviewEntry)}">`,
    `Relire une étape passée</button> — lecture seule, rien n'est modifié.`,
    `</p>`,
  ].join('')
}

function renderReviewNotice(model: ViewModel): string {
  return [
    `<section class="banner review">`,
    `<p class="summary">Lecture seule — étape ${escapeHtml(model.stepId)}, déjà validée.</p>`,
    `<p class="muted">Aucun de tes fichiers n'est touché tant que tu ne demandes pas de refaire l'étape.</p>`,
    `</section>`,
  ].join('')
}

/** Navigation entre étapes validées, et retour. Aucun de ces gestes n'écrit quoi que ce soit. */
function renderReviewActions(review: ReviewView): string {
  const buttons: string[] = []
  if (review.previousStepId !== undefined) {
    buttons.push(
      `<button type="button" class="secondary" data-action="review" data-step="${escapeHtml(review.previousStepId)}">← Étape ${escapeHtml(review.previousStepId)}</button>`
    )
  }
  if (review.nextStepId !== undefined) {
    buttons.push(
      `<button type="button" class="secondary" data-action="review" data-step="${escapeHtml(review.nextStepId)}">Étape ${escapeHtml(review.nextStepId)} →</button>`
    )
  }
  buttons.push(`<button type="button" data-action="reviewExit">Revenir à l'étape en cours</button>`)
  return `<div class="actions">${buttons.join('')}</div>`
}

/**
 * Refaire l'étape, seul geste de tout le panneau qui écrit dans le code de l'utilisateur
 * (D36). Il vit dans son propre encadré, à l'écart de la navigation de relecture, il
 * nomme les fichiers concernés avant même la confirmation, et son libellé se termine par
 * des points de suspension : un clic ici ouvre une boîte, il ne restaure rien.
 */
function renderRedo(redo: RedoView): string {
  if (!redo.available) {
    return [
      `<section class="card redo">`,
      `<h3>Refaire cette étape</h3>`,
      `<p class="muted">${escapeHtml(redo.reason ?? 'Indisponible pour ce projet.')}</p>`,
      `</section>`,
    ].join('')
  }
  const files = redo.files.map((file) => `<code class="file">${escapeHtml(file)}</code>`).join(' ')
  return [
    `<section class="card redo">`,
    `<h3>Refaire cette étape</h3>`,
    `<p>Ces fichiers seront remplacés par leur contenu d'avant l'étape ${escapeHtml(redo.stepId)} : ${files}</p>`,
    `<p class="muted">Aucun autre fichier n'est touché, et un point de restauration git est créé avant l'opération.</p>`,
    `<div class="actions"><button type="button" class="danger" data-action="redo" data-step="${escapeHtml(redo.stepId)}">Refaire l'étape ${escapeHtml(redo.stepId)}…</button></div>`,
    `</section>`,
  ].join('')
}

function renderRecap(recap: readonly RecapStepView[]): string {
  if (recap.length === 0) return ''
  const rows = recap
    .map((step) => {
      const mark = step.solution
        ? 'solution affichée'
        : step.hints > 0
          ? `${step.hints} indice${step.hints > 1 ? 's' : ''}`
          : 'sans aide'
      return `<li><strong>${escapeHtml(step.id)}</strong> ${escapeHtml(step.title)} <span class="muted">— ${escapeHtml(mark)}</span></li>`
    })
    .join('')
  return `<section class="card recap"><h3>Récapitulatif</h3><ul>${rows}</ul></section>`
}

function renderRegressions(regressions: readonly RegressionView[], stale = ''): string {
  if (regressions.length === 0) return ''
  // Bandeau à part : c'est une étape précédente qui casse, pas l'étape courante (D16).
  const items = regressions
    .map((regression) => {
      const lines = [
        `<strong>Étape ${escapeHtml(regression.stepId)} — ${escapeHtml(regression.stepTitle)}</strong>`,
        `<code class="file">${escapeHtml(regression.testFile)}</code>`,
      ]
      if (regression.testName !== undefined) {
        lines.push(`<div class="test-name">${escapeHtml(regression.testName)}</div>`)
      }
      lines.push(renderDetail(regression.detail, regression.explained))
      return `<li>${lines.join('')}</li>`
    })
    .join('')
  return `<section class="banner regression${stale}"><h3>En attente — une étape précédente ne passe plus</h3><ul>${items}</ul></section>`
}

function renderStatusZone(status: StatusView, stale = ''): string {
  if (status.kind === 'none') return ''

  const parts: string[] = []
  if (status.summary !== '') parts.push(`<p class="summary">${escapeHtml(status.summary)}</p>`)
  // `summary` porte déjà « Test en échec : <fullName> » : le répéter juste dessous fait
  // lire deux fois la même ligne pour rien.
  if (status.testName !== undefined && !status.summary.includes(status.testName)) {
    parts.push(`<div class="test-name">${escapeHtml(status.testName)}</div>`)
  }
  parts.push(renderDetail(status.detail, status.explained))
  const flash = status.advanced ? ' flash' : ''
  return `<section class="banner ${status.kind}${flash}${stale}">${parts.join('')}</section>`
}

/**
 * Le brut reste **toujours** accessible. Quand la forme est reconnue, la traduction passe
 * devant et le brut se replie ; sinon le brut s'affiche seul, sans reformulation.
 */
function renderDetail(detail: string | undefined, explained: string | undefined): string {
  if (detail === undefined) return ''
  const raw = `<pre class="detail">${escapeHtml(detail)}</pre>`
  if (explained === undefined) return raw
  return [
    `<p class="explained">${escapeHtml(explained)}</p>`,
    `<details class="raw"><summary>Message brut de Vitest</summary>${raw}</details>`,
  ].join('')
}

/**
 * Coloration syntaxique, quatre catégories : commentaire, chaîne, nombre, mot-clé. Le
 * tokenizer tient en une expression et couvre la famille JS/TS, celle des parcours ;
 * ailleurs le code sort échappé, sans couleur, ce qui reste lisible.
 *
 * ponytail: tokenizer par regex, sans état — un mot-clé dans un identifiant composé n'est
 * pas coloré à tort (les `\b` s'en chargent), mais une regex littérale contenant un
 * guillemet le serait. Passer à un vrai lexeur si un parcours non-JS le demande.
 */
export function highlight(file: string, source: string): string {
  if (!/\.(?:[mc]?[jt]sx?)$/i.test(file)) return escapeHtml(source)

  let out = ''
  let last = 0
  for (const match of source.matchAll(TOKEN)) {
    const text = match[0] ?? ''
    const at = match.index ?? 0
    const kind =
      match[1] !== undefined
        ? 'comment'
        : match[2] !== undefined
          ? 'string'
          : match[3] !== undefined
            ? 'number'
            : 'keyword'
    out += escapeHtml(source.slice(last, at))
    out += `<span class="tok-${kind}">${escapeHtml(text)}</span>`
    last = at + text.length
  }
  return out + escapeHtml(source.slice(last))
}

const KEYWORDS = [
  'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'from',
  'function', 'get', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let',
  'new', 'null', 'of', 'private', 'protected', 'public', 'readonly', 'return', 'satisfies',
  'set', 'static', 'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof', 'undefined',
  'var', 'void', 'while', 'yield',
].join('|')

const TOKEN = new RegExp(
  [
    String.raw`(\/\*[\s\S]*?\*\/|\/\/[^\n]*)`,
    String.raw`('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|\`(?:[^\`\\]|\\.)*\`)`,
    String.raw`\b(0[xXbBoO][\da-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][-+]?\d+)?)\b`,
    String.raw`\b(?:${KEYWORDS})\b`,
  ].join('|'),
  'g'
)

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
