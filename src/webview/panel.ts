import * as vscode from 'vscode'
import type { ViewModel } from '../core/viewmodel'
import { escapeHtml, renderHeader, renderMain, renderStatus, renderWelcome } from './render'
import { renderShell } from './shell'
import { type HostMessage, type WebviewMessage, parseWebviewMessage } from './protocol'

const VIEW_TYPE = 'learnpath.parcours'

/**
 * Panneau du parcours. C'est une vue de la barre d'activité (`WebviewViewProvider`) et
 * plus un onglet d'éditeur : l'extension avait une icône nulle part et tout passait par la
 * palette. Le fournisseur vit toute la session, la webview, elle, va et vient — d'où le
 * dernier message rendu gardé ici et repoussé sur `ready`.
 *
 * La classe ne décide rien. Elle rend un `ViewModel` (construit par `src/core`) et
 * remonte les messages validés. Tout ce qui est testable est dans `render.ts`.
 */
export class ParcoursPanel implements vscode.WebviewViewProvider {
  private static instance: ParcoursPanel | undefined

  /** Le fournisseur enregistré. Le watcher lui pousse le view model. */
  static get current(): ParcoursPanel | undefined {
    return ParcoursPanel.instance
  }

  /** Un seul fournisseur pour la vie de l'extension. */
  static register(): vscode.Disposable {
    ParcoursPanel.instance ??= new ParcoursPanel()
    return vscode.window.registerWebviewViewProvider(VIEW_TYPE, ParcoursPanel.instance, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  }

  /**
   * Révèle la vue **sans jamais prendre le focus**. `<viewId>.focus` accepte
   * `preserveFocus` : voler le curseur pendant que l'utilisateur tape est rédhibitoire, et
   * l'ouverture comme le passage à l'étape suivante arrivent pendant qu'il écrit.
   */
  static show(): void {
    void vscode.commands.executeCommand(`${VIEW_TYPE}.focus`, { preserveFocus: true })
  }

  /** Dernier message rendu, repoussé quand la webview signale qu'elle est prête. */
  private last: HostMessage | undefined
  private handler: ((message: WebviewMessage) => void) | undefined
  private view: vscode.WebviewView | undefined

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = { enableScripts: true }
    view.webview.html = renderShell(createNonce())
    view.onDidDispose(() => {
      this.view = undefined
    })
    view.webview.onDidReceiveMessage((raw: unknown) => {
      const message = parseWebviewMessage(raw)
      if (message === undefined) return
      // Une webview prête a perdu son contenu : on lui repousse le dernier rendu.
      if (message.type === 'ready') {
        this.post(this.last)
        return
      }
      // L'import est le seul geste possible sans parcours : il n'a pas de session à qui
      // s'adresser, il passe donc par la commande.
      if (message.type === 'import') {
        void vscode.commands.executeCommand('learnpath.import')
        return
      }
      // Composer le prompt n'a pas non plus de session à qui s'adresser, et reste
      // disponible avec un parcours en cours : on génère un parcours par fonctionnalité.
      if (message.type === 'generatePrompt') {
        void vscode.commands.executeCommand('learnpath.generatePrompt')
        return
      }
      this.handler?.(message)
    })
  }

  /** Les clics de la webview, déjà validés. */
  onMessage(handler: (message: WebviewMessage) => void): void {
    this.handler = handler
  }

  update(model: ViewModel | undefined): void {
    if (model === undefined) return
    if (this.view !== undefined) this.view.description = model.parcoursTitle
    this.post({
      type: 'render',
      stepId: model.stepId,
      header: renderHeader(model),
      main: renderMain(model),
      status: renderStatus(model),
    })
  }

  /** Aucun parcours dans ce dossier : la vue dit quoi faire au lieu de rester vide. */
  showWelcome(): void {
    this.handler = undefined
    if (this.view !== undefined) this.view.description = undefined
    this.post({
      type: 'render',
      stepId: '',
      header: '<h1>LearnPath</h1>',
      main: renderWelcome(),
      status: '',
    })
  }

  /** Erreur de session : le panneau le dit plutôt que de rester sur un contenu périmé. */
  showError(message: string): void {
    this.post({
      type: 'render',
      stepId: '',
      header: '<h1>LearnPath</h1>',
      main: `<section class="banner failed"><p class="summary">${escapeHtml(message)}</p></section>`,
      status: '',
    })
  }

  private post(message: HostMessage | undefined): void {
    if (message === undefined) return
    this.last = message
    void this.view?.webview.postMessage(message)
  }
}

export function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let nonce = ''
  for (let i = 0; i < 32; i++) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length))
  }
  return nonce
}
