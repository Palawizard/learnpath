import * as vscode from 'vscode'
import { composePrompt } from '../core/prompt'
import { createNonce } from './panel'
import { renderPromptPage } from './prompt-form'

/**
 * Le prompt de génération, composé depuis l'extension. Il vivait en deux exemplaires
 * divergents (README et spec), recopiés à la main : un parcours a fini par être généré
 * avec une version périmée. Le gabarit unique est `prompts/generer-parcours.md`, embarqué
 * dans le paquet et lu ici.
 *
 * C'est un panneau d'éditeur à part, pas la vue du parcours : la vue est repeinte à chaque
 * run de tests, ce qui effacerait le formulaire en cours de saisie.
 *
 * Le prompt composé est **affiché en entier et modifiable**. Un formulaire qui le masque
 * retire toute prise à l'utilisateur le jour où le résultat le déçoit — précisément le
 * moment où il en a besoin.
 */
export class PromptPanel {
  private static open: vscode.WebviewPanel | undefined

  static async show(extensionUri: vscode.Uri): Promise<void> {
    if (PromptPanel.open !== undefined) {
      PromptPanel.open.reveal()
      return
    }
    const panel = vscode.window.createWebviewPanel(
      'learnpath.prompt',
      'LearnPath — prompt de génération',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    )
    PromptPanel.open = panel
    panel.onDidDispose(() => {
      PromptPanel.open = undefined
    })
    panel.webview.html = renderPromptPage(createNonce(), await projectNotice())
    panel.webview.onDidReceiveMessage((raw: unknown) => void handle(panel, extensionUri, raw))
  }
}

async function handle(
  panel: vscode.WebviewPanel,
  extensionUri: vscode.Uri,
  raw: unknown
): Promise<void> {
  if (typeof raw !== 'object' || raw === null) return
  const message = raw as Record<string, unknown>

  if (message['type'] === 'copy') {
    const text = message['text']
    if (typeof text !== 'string' || text === '') return
    await vscode.env.clipboard.writeText(text)
    void vscode.window.setStatusBarMessage('LearnPath — prompt copié', 3000)
    return
  }

  if (message['type'] !== 'compose') return
  const feature = message['feature']
  const level = message['level']
  const files = message['files']
  if (typeof feature !== 'string' || typeof level !== 'string') return

  let template: string
  try {
    const uri = vscode.Uri.joinPath(extensionUri, 'prompts', 'generer-parcours.md')
    template = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')
  } catch (error) {
    void panel.webview.postMessage({
      type: 'error',
      message: `Gabarit de prompt introuvable dans l'extension : ${error instanceof Error ? error.message : String(error)}`,
    })
    return
  }

  const composed = composePrompt(template, {
    feature,
    level,
    files: typeof files === 'string' ? files : undefined,
  })
  void panel.webview.postMessage(
    composed.ok
      ? { type: 'prompt', text: composed.value }
      : { type: 'error', message: composed.error }
  )
}

/**
 * Le générateur a besoin d'un projet JS/TS pour écrire des tests Vitest qui tournent. On le
 * dit, on ne bloque pas : un dossier sans `package.json` peut très bien en recevoir un à
 * l'étape suivante, et ce n'est pas à ce formulaire d'en décider.
 */
async function projectNotice(): Promise<string | undefined> {
  const root = vscode.workspace.workspaceFolders?.[0]
  if (root === undefined) return "Aucun dossier n'est ouvert : le parcours sera généré sans voir ton projet."
  try {
    await vscode.workspace.fs.stat(vscode.Uri.joinPath(root.uri, 'package.json'))
    return undefined
  } catch {
    return 'Ce dossier ne ressemble pas à un projet JavaScript ou TypeScript (pas de package.json). Le prompt reste utilisable, mais LearnPath ne joue que des parcours Vitest.'
  }
}

