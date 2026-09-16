/**
 * Coquille statique du panneau, posée une seule fois. Les mises à jour passent par
 * `postMessage` : réécrire `webview.html` à chaque run remettrait le scroll en haut et,
 * surtout, remplacerait l'élément `aria-live`, ce qui annulerait l'annonce.
 *
 * CSP : `default-src 'none'`. Aucune image, aucune police distante, aucun `connect-src`.
 * Le style et le script sont inline et portent le nonce.
 */
export function renderShell(nonce: string): string {
  const csp = [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ')

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>LearnPath</title>
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<header id="header"></header>
<main id="main"></main>
<div id="status" role="status" aria-live="polite" aria-atomic="true"></div>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`
}

/** Aucune couleur en dur : tout passe par les variables du thème, thème contrasté inclus. */
const STYLE = `
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  padding: 0.75rem 1rem 1.5rem;
  line-height: 1.5;
}
h1 { font-size: 1.15rem; margin: 0; }
h2 { font-size: 1.05rem; margin: 1rem 0 0.5rem; }
h3 { font-size: 0.85rem; margin: 0 0 0.5rem; text-transform: uppercase;
     letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); }
p { margin: 0 0 0.6rem; }
a { color: var(--vscode-textLink-foreground); }
code, pre, .file {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 0.92em;
}
code, .file {
  background: var(--vscode-textCodeBlock-background);
  padding: 0.05rem 0.3rem;
  border-radius: 3px;
}
pre {
  background: var(--vscode-textCodeBlock-background);
  padding: 0.5rem 0.6rem;
  border-radius: 3px;
  white-space: pre-wrap;
  overflow-x: auto;
  margin: 0.4rem 0 0;
}
pre code { background: none; padding: 0; }
blockquote {
  margin: 0.6rem 0;
  padding-left: 0.75rem;
  border-left: 2px solid var(--vscode-panel-border);
  color: var(--vscode-descriptionForeground);
}
.counter { color: var(--vscode-descriptionForeground); margin: 0.2rem 0 0.4rem; }
.bar { display: flex; gap: 2px; }
.segment {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--vscode-editorWidget-background, var(--vscode-textCodeBlock-background));
}
.segment.done { background: var(--vscode-progressBar-background); }
.segment.current {
  background: var(--vscode-editorWidget-background, var(--vscode-textCodeBlock-background));
  outline: 1px solid var(--vscode-progressBar-background);
  outline-offset: -1px;
}
.card {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  padding: 0.6rem 0.75rem;
  margin: 1rem 0;
}
.acceptance, .hint-list, .recap ul { margin: 0.4rem 0 0; padding-left: 1.2rem; }
/* Le numéro est déjà dans le texte (.hint-index) : sans ça, « 1. 1. ». */
.hint-list { list-style: none; padding-left: 0; }
.acceptance li, .hint-list li, .recap li { margin: 0.2rem 0; }
.hint-index { color: var(--vscode-descriptionForeground); }
.muted { color: var(--vscode-descriptionForeground); }
.actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 1rem 0; }
button {
  font-family: inherit;
  font-size: inherit;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border: 1px solid var(--vscode-button-border, transparent);
  border-radius: 3px;
  padding: 0.35rem 0.9rem;
  cursor: pointer;
}
button:hover:enabled { background: var(--vscode-button-hoverBackground); }
button.secondary {
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
}
button.secondary:hover:enabled { background: var(--vscode-button-secondaryHoverBackground); }
button:disabled { opacity: 0.5; cursor: default; }
button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.solution-file { margin-top: 0.6rem; }
.solution-file:first-of-type { margin-top: 0.4rem; }
.solution-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.solution-head button { padding: 0.15rem 0.6rem; font-size: 0.9em; }
.solution .code, .scaffold .code, .examples .code, .test-source .code {
  max-height: 22rem;
  overflow: auto;
  white-space: pre;
}
details > summary { cursor: pointer; color: var(--vscode-textLink-foreground); }
details > summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.card.about > summary { color: var(--vscode-foreground); font-weight: 600; }
.card.about ul { margin: 0.3rem 0 0.4rem; padding-left: 1.2rem; }
.card.about h3 { margin-top: 0.6rem; }
.test-source { margin-top: 0.6rem; }
.test-source .file { display: inline-block; margin-top: 0.3rem; }
.examples h4 { margin: 0.6rem 0 0; font-size: 1em; }
.example-notes ul { margin: 0.4rem 0 0; padding-left: 1.2rem; }
.example-notes li { margin: 0.15rem 0; }
.diff-legend { margin: 0.4rem 0 0; }
.full-file { margin-top: 0.4rem; }
.diff-line { display: block; }
.diff-line.add {
  background: var(--vscode-diffEditor-insertedLineBackground, var(--vscode-diffEditor-insertedTextBackground));
}
.diff-line.del {
  background: var(--vscode-diffEditor-removedLineBackground, var(--vscode-diffEditor-removedTextBackground));
  text-decoration: line-through;
  color: var(--vscode-descriptionForeground);
}
.diff-line.skip { color: var(--vscode-descriptionForeground); }
.banner.pacing {
  border-left-color: var(--vscode-panel-border);
  background: var(--vscode-textCodeBlock-background);
  margin: 1rem 0;
}
.banner.pacing .muted { margin: 0.2rem 0 0; }
.tok-comment { color: var(--vscode-descriptionForeground); font-style: italic; }
.tok-string { color: var(--vscode-symbolIcon-stringForeground, var(--vscode-charts-orange)); }
.tok-number { color: var(--vscode-symbolIcon-numberForeground, var(--vscode-charts-green)); }
.tok-keyword { color: var(--vscode-symbolIcon-keywordForeground, var(--vscode-charts-purple)); }
#status { margin-top: 1rem; }
.running {
  color: var(--vscode-descriptionForeground);
  margin: 0 0 0.4rem;
}
/* Le run en cours périme ce qui est affiché : on ne lit pas un rouge d'il y a deux
   secondes comme un rouge à jour. */
.banner.stale { opacity: 0.5; }
.explained { margin: 0.35rem 0 0; }
.raw { margin-top: 0.35rem; }
.raw summary {
  cursor: pointer;
  color: var(--vscode-descriptionForeground);
  font-size: 0.92em;
}
.banner {
  border-left: 3px solid transparent;
  border-radius: 3px;
  padding: 0.5rem 0.75rem;
  margin-top: 0.6rem;
}
.banner .summary { margin: 0; }
.banner .test-name { margin-top: 0.35rem; font-family: var(--vscode-editor-font-family, monospace); }
.banner .detail { color: var(--vscode-descriptionForeground); }
.banner.progress {
  color: var(--vscode-descriptionForeground);
  border-left-color: var(--vscode-panel-border);
  background: var(--vscode-textCodeBlock-background);
}
.banner.failed {
  border-left-color: var(--vscode-editorError-foreground, var(--vscode-charts-red));
  background: var(--vscode-inputValidation-errorBackground, var(--vscode-textCodeBlock-background));
}
.banner.failed .summary { color: var(--vscode-editorError-foreground, var(--vscode-charts-red)); }
.banner.passed {
  border-left-color: var(--vscode-charts-green, var(--vscode-testing-iconPassed));
  background: var(--vscode-textCodeBlock-background);
}
/* Refaire une étape est le seul geste destructif du panneau : le bouton se distingue des
   actions ordinaires, et son encadré est séparé de la navigation de relecture. */
button.danger {
  color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground));
  background: var(--vscode-inputValidation-errorBackground, var(--vscode-textCodeBlock-background));
  border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground));
}
button.danger:hover:enabled { background: var(--vscode-inputValidation-errorBackground); }
button.link {
  color: var(--vscode-textLink-foreground);
  background: none;
  border: none;
  padding: 0;
  text-decoration: underline;
  font-size: inherit;
}
button.link:hover:enabled { color: var(--vscode-textLink-activeForeground); background: none; }
.review-entry { margin-top: 1rem; }
.card.redo { border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-panel-border)); }
.card.redo .actions { margin-bottom: 0; }
.banner.review {
  border-left-color: var(--vscode-panel-border);
  background: var(--vscode-textCodeBlock-background);
  margin-bottom: 1rem;
}
.banner.review .muted { margin: 0.2rem 0 0; }
.banner.regression {
  border-left-color: var(--vscode-editorWarning-foreground, var(--vscode-charts-yellow));
  background: var(--vscode-textCodeBlock-background);
}
.banner.regression ul { margin: 0.3rem 0 0; padding-left: 1.1rem; }
.banner.flash { animation: flash 900ms ease-out 1; }
@keyframes flash {
  from { background: var(--vscode-charts-green, var(--vscode-testing-iconPassed)); }
  to { background: var(--vscode-textCodeBlock-background); }
}
@media (prefers-reduced-motion: reduce) {
  .banner.flash { animation: none; }
}
body.vscode-high-contrast .card,
body.vscode-high-contrast .banner,
body.vscode-high-contrast button {
  border: 1px solid var(--vscode-contrastBorder);
}
body.vscode-high-contrast .banner { border-left-width: 3px; }
`

/**
 * Le script ne calcule rien : il pose trois fragments et renvoie les clics. Le panneau ne
 * prend jamais le focus, donc aucun `focus()` ici non plus.
 */
const SCRIPT = `
const vscode = acquireVsCodeApi();
const header = document.getElementById('header');
const main = document.getElementById('main');
const statusZone = document.getElementById('status');
let stepId = '';

function paint(model) {
  if (!model) return;
  stepId = model.stepId;
  header.innerHTML = model.header;
  main.innerHTML = model.main;
  statusZone.innerHTML = model.status;
}

paint(vscode.getState());

window.addEventListener('message', (event) => {
  const model = event.data;
  if (!model || model.type !== 'render') return;
  vscode.setState(model);
  paint(model);
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'import' || action === 'generatePrompt') {
    vscode.postMessage({ type: action });
    return;
  }
  if (action === 'copy' || action === 'copyScaffold') {
    vscode.postMessage({ type: action === 'copy' ? 'copySolution' : 'copyScaffold', stepId: stepId, file: button.dataset.file });
    return;
  }
  if (action === 'scaffold') {
    vscode.postMessage({ type: 'revealScaffold', stepId: stepId });
    return;
  }
  // Relire et refaire portent l'étape visée dans le bouton : c'est une étape passée, pas
  // celle du rendu courant. L'extension revalide l'id de son côté.
  if (action === 'review' || action === 'redo') {
    vscode.postMessage({ type: action, stepId: button.dataset.step });
    return;
  }
  if (action === 'reviewExit') {
    vscode.postMessage({ type: 'reviewExit' });
    return;
  }
  vscode.postMessage({ type: action === 'hint' ? 'revealHint' : 'revealSolution', stepId: stepId });
});

vscode.postMessage({ type: 'ready' });
`
