import * as vscode from 'vscode'
import { ParcoursPanel } from './webview/panel'

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('learnpath.open', () => {
      ParcoursPanel.show()
    }),
    vscode.commands.registerCommand('learnpath.import', () => notImplemented('Importer un parcours')),
    vscode.commands.registerCommand('learnpath.runStep', () => notImplemented("Relancer les tests de l'étape")),
    vscode.commands.registerCommand('learnpath.reset', () => notImplemented('Réinitialiser le parcours')),
  )
}

export function deactivate(): void {
  // rien à libérer : tout passe par context.subscriptions
}

function notImplemented(label: string): void {
  void vscode.window.showInformationMessage(`LearnPath — ${label} : pas encore implémenté.`)
}
