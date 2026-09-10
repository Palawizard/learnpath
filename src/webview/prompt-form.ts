import { escapeHtml } from './render.js'

/**
 * Page du générateur de prompt. Sans `vscode`, comme `render.ts` : c'est ce qui la rend
 * testable. Le câblage vit dans `prompt-panel.ts`.
 */

/** CSP identique à celle de la vue du parcours : rien d'externe, style et script au nonce. */
export function renderPromptPage(nonce: string, notice: string | undefined): string {
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
<title>LearnPath — prompt de génération</title>
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<h1>Prompt de génération du parcours</h1>
<p class="muted">Décris ce que tu veux coder. LearnPath compose le prompt à coller à ton
agent de code — il est affiché en entier ci-dessous, et tu peux le modifier avant de le
copier.</p>
${notice === undefined ? '' : `<p class="notice">${escapeHtml(notice)}</p>`}
<form id="form">
  <label for="feature">La fonctionnalité à implémenter</label>
  <textarea id="feature" rows="4" required
    placeholder="Un panier d'achat : ajouter, retirer, calculer le total"></textarea>

  <label for="level">Ton niveau</label>
  <select id="level">
    <option value="débutant">débutant</option>
    <option value="intermédiaire" selected>intermédiaire</option>
  </select>

  <label for="files">Fichiers ou dossiers concernés <span class="muted">— facultatif</span></label>
  <input id="files" type="text" placeholder="src/panier/, src/types.ts">

  <div class="actions"><button type="submit">Générer le prompt</button></div>
</form>
<p id="error" class="error" role="alert"></p>
<section id="output" hidden>
  <div class="output-head">
    <h2>Le prompt</h2>
    <button type="button" id="copy">Copier</button>
  </div>
  <p class="muted">Modifiable : ce que tu copies est exactement ce qu'il y a dans cette zone.</p>
  <textarea id="prompt" rows="24" spellcheck="false"></textarea>
</section>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`
}

const STYLE = `
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  padding: 1rem 1.25rem 2rem;
  line-height: 1.5;
  max-width: 60rem;
}
h1 { font-size: 1.2rem; margin: 0 0 0.5rem; }
h2 { font-size: 1.05rem; margin: 0; }
p { margin: 0 0 0.75rem; }
.muted { color: var(--vscode-descriptionForeground); }
.notice {
  border-left: 3px solid var(--vscode-editorWarning-foreground, var(--vscode-charts-yellow));
  background: var(--vscode-textCodeBlock-background);
  border-radius: 3px;
  padding: 0.5rem 0.75rem;
}
.error:empty { display: none; }
.error {
  color: var(--vscode-editorError-foreground, var(--vscode-charts-red));
  border-left: 3px solid var(--vscode-editorError-foreground, var(--vscode-charts-red));
  background: var(--vscode-inputValidation-errorBackground, var(--vscode-textCodeBlock-background));
  border-radius: 3px;
  padding: 0.5rem 0.75rem;
}
label { display: block; margin: 1rem 0 0.25rem; }
textarea, input, select {
  width: 100%;
  box-sizing: border-box;
  font-family: inherit;
  font-size: inherit;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 3px;
  padding: 0.35rem 0.5rem;
}
#prompt {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 0.92em;
  white-space: pre;
  overflow-wrap: normal;
  margin-top: 0.25rem;
}
textarea:focus-visible, input:focus-visible, select:focus-visible, button:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 1px;
}
.actions { margin: 1rem 0 0; }
.output-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 1.5rem 0 0.25rem;
}
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
button:hover { background: var(--vscode-button-hoverBackground); }
body.vscode-high-contrast button,
body.vscode-high-contrast textarea,
body.vscode-high-contrast input,
body.vscode-high-contrast select { border: 1px solid var(--vscode-contrastBorder); }
`

/**
 * Le script ne compose rien : la composition est dans `src/core/prompt.ts`, testée hors
 * extension. Il collecte trois champs et affiche ce qu'on lui renvoie.
 */
const SCRIPT = `
const vscode = acquireVsCodeApi();
const output = document.getElementById('output');
const prompt = document.getElementById('prompt');
const error = document.getElementById('error');

document.getElementById('form').addEventListener('submit', (event) => {
  event.preventDefault();
  vscode.postMessage({
    type: 'compose',
    feature: document.getElementById('feature').value,
    level: document.getElementById('level').value,
    files: document.getElementById('files').value,
  });
});

document.getElementById('copy').addEventListener('click', () => {
  vscode.postMessage({ type: 'copy', text: prompt.value });
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message) return;
  if (message.type === 'prompt') {
    error.textContent = '';
    prompt.value = message.text;
    output.hidden = false;
    return;
  }
  if (message.type === 'error') {
    error.textContent = message.message;
  }
});
`
