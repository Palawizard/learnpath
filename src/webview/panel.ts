import * as vscode from 'vscode'

const VIEW_TYPE = 'learnpath.parcours'

/**
 * Panneau du parcours. Singleton : ouvrir deux fois ne crée pas deux panneaux,
 * le state du parcours n'aurait pas de raison d'être dupliqué.
 */
export class ParcoursPanel {
  private static current: ParcoursPanel | undefined

  private readonly panel: vscode.WebviewPanel
  private readonly disposables: vscode.Disposable[] = []

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables)
    this.render()
  }

  static show(column?: vscode.ViewColumn): ParcoursPanel {
    const target = column ?? vscode.ViewColumn.Beside

    if (ParcoursPanel.current) {
      ParcoursPanel.current.panel.reveal(target)
      return ParcoursPanel.current
    }

    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'LearnPath', target, {
      enableScripts: true,
      retainContextWhenHidden: true,
    })

    ParcoursPanel.current = new ParcoursPanel(panel)
    return ParcoursPanel.current
  }

  private render(): void {
    this.panel.webview.html = this.html()
  }

  private html(): string {
    const nonce = createNonce()
    const workspace = vscode.workspace.name ?? 'aucun dossier ouvert'
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
<style nonce="${nonce}">
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 1rem 1.25rem;
  }
  h1 { font-size: 1.1rem; margin: 0 0 0.25rem; }
  p { color: var(--vscode-descriptionForeground); margin: 0; }
</style>
</head>
<body>
  <h1>LearnPath</h1>
  <p>Espace de travail : ${escapeHtml(workspace)}</p>
  <p>Aucun parcours chargé.</p>
</body>
</html>`
  }

  dispose(): void {
    ParcoursPanel.current = undefined
    this.panel.dispose()
    for (const d of this.disposables.splice(0)) {
      d.dispose()
    }
  }
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let nonce = ''
  for (let i = 0; i < 32; i++) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length))
  }
  return nonce
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
