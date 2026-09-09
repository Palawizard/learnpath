import type { RecapStepView, RegressionView, StatusView, ViewModel } from '../core/viewmodel.js'
import { renderMarkdown } from './markdown.js'

/**
 * Rendu du view model en HTML. Aucun import `vscode` : c'est ce qui rend le panneau
 * testable. Deux fragments plutôt qu'une page entière, parce que la zone d'état est une
 * région `aria-live` — la remplacer élément compris, c'est perdre l'annonce.
 */

export function renderMain(model: ViewModel): string {
  // Fin de parcours : l'énoncé de la dernière étape n'intéresse plus personne, et le
  // laisser au-dessus du récapitulatif donne un écran de fin qui ressemble à une étape.
  if (model.finished) return renderRecap(model.recap)

  return [
    `<h2 class="step-title">${escapeHtml(model.stepTitle)}</h2>`,
    `<div class="explanation">${renderMarkdown(model.explanation)}</div>`,
    renderExpected(model),
    renderHints(model),
    renderActions(model),
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
  const counter = model.finished
    ? `Parcours terminé — ${model.total} étapes`
    : `Étape ${model.position} / ${model.total}`
  // Un segment par étape, pas une jauge continue : « Étape 5 / 5 » avec une barre aux
  // quatre cinquièmes se lisait comme une incohérence. Ici les deux comptent la même
  // chose — quatre segments acquis, le cinquième en cours.
  const segments = Array.from({ length: model.total }, (_, i) => {
    const done = model.finished || i < model.position - 1
    const current = !model.finished && i === model.position - 1
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

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
