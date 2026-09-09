import * as vscode from 'vscode'
import type { ViewModel } from '../core/viewmodel'
import { escapeHtml, renderHeader, renderMain, renderStatus } from './render'
import { renderShell } from './shell'
import { type WebviewMessage, parseWebviewMessage } from './protocol'

const VIEW_TYPE = 'learnpath.parcours'

/**
 * Panneau du parcours. Singleton : ouvrir deux fois ne crée pas deux panneaux, le state
 * du parcours n'aurait pas de raison d'être dupliqué.
 *
 * La classe ne décide rien. Elle rend un `ViewModel` (construit par `src/core`) et
 * remonte les messages validés. Tout ce qui est testable est dans `render.ts`.
 */
export class ParcoursPanel {
  private static instance: ParcoursPanel | undefined

  /** Le panneau ouvert, s'il y en a un. Le watcher lui pousse le view model. */
  static get current(): ParcoursPanel | undefined {
    return ParcoursPanel.instance
  }

  /** Dernier modèle rendu, renvoyé quand la webview signale qu'elle est prête. */
  private model: ViewModel | undefined
  private handler: ((message: WebviewMessage) => void) | undefined

  private readonly panel: vscode.WebviewPanel
  private readonly disposables: vscode.Disposable[] = []

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel
    this.panel.webview.html = renderShell(createNonce())
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables)
    this.panel.webview.onDidReceiveMessage(
      (raw: unknown) => {
        const message = parseWebviewMessage(raw)
        if (message === undefined) return
        // Une webview prête a perdu son contenu : on lui repousse le modèle courant.
        if (message.type === 'ready') {
          this.update(this.model)
          return
        }
        this.handler?.(message)
      },
      null,
      this.disposables
    )
  }

  /**
   * Ouvre le panneau **sans jamais prendre le focus**. `preserveFocus` à la création comme
   * au `reveal` : voler le curseur pendant que l'utilisateur tape est rédhibitoire, et
   * l'ouverture comme le passage à l'étape suivante arrivent pendant qu'il écrit.
   */
  static show(column?: vscode.ViewColumn): ParcoursPanel {
    const viewColumn = column ?? vscode.ViewColumn.Beside

    if (ParcoursPanel.instance) {
      ParcoursPanel.instance.panel.reveal(viewColumn, true)
      return ParcoursPanel.instance
    }

    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'LearnPath',
      { viewColumn, preserveFocus: true },
      {
        enableScripts: true,
        // L'onglet masqué puis réaffiché retrouve son contenu et son scroll. Le script
        // sauvegarde aussi son modèle via `setState`, au cas où le contexte serait perdu.
        retainContextWhenHidden: true,
      }
    )

    ParcoursPanel.instance = new ParcoursPanel(panel)
    return ParcoursPanel.instance
  }

  /** Les clics de la webview, déjà validés. */
  onMessage(handler: (message: WebviewMessage) => void): void {
    this.handler = handler
  }

  update(model: ViewModel | undefined): void {
    if (model === undefined) return
    this.model = model
    this.panel.title = `LearnPath — ${model.parcoursTitle}`
    void this.panel.webview.postMessage({
      type: 'render',
      stepId: model.stepId,
      header: renderHeader(model),
      main: renderMain(model),
      status: renderStatus(model),
    })
  }

  /** Erreur de session : le panneau le dit plutôt que de rester sur un contenu périmé. */
  showError(message: string): void {
    void this.panel.webview.postMessage({
      type: 'render',
      stepId: '',
      header: '<h1>LearnPath</h1>',
      main: `<section class="banner failed"><p class="summary">${escapeHtml(message)}</p></section>`,
      status: '',
    })
  }

  dispose(): void {
    ParcoursPanel.instance = undefined
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
