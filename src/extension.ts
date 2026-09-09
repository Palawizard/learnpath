import * as vscode from 'vscode'
import { loadParcours } from './core/parcours'
import { importParcours } from './core/importer'
import { removeParcours, restartParcours } from './core/reset'
import { ParcoursPanel } from './webview/panel'
import { Watcher } from './watcher'

let output: vscode.OutputChannel | undefined
let watcher: Watcher | undefined

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('LearnPath')
  context.subscriptions.push(
    output,
    { dispose: () => stopWatching() },
    vscode.commands.registerCommand('learnpath.open', () => void openCommand()),
    vscode.commands.registerCommand('learnpath.import', () => void importCommand()),
    vscode.commands.registerCommand('learnpath.runStep', () => void runStepCommand()),
    vscode.commands.registerCommand('learnpath.reset', () => void resetCommand()),
  )
  // Le panneau s'ouvre tout seul quand il y a un parcours : c'est l'objet de l'extension.
  // `ParcoursPanel.show` ne prend pas le focus, l'utilisateur reste dans son éditeur.
  void startWatching().then(() => watcher?.show())
}

export function deactivate(): void {
  stopWatching()
}

/** Un seul watcher vivant : réimporter ou changer de parcours remplace l'abonnement. */
async function startWatching(): Promise<void> {
  stopWatching()
  const root = vscode.workspace.workspaceFolders?.[0]
  if (root === undefined) return
  watcher = await Watcher.open(root.uri.fsPath, (line) => log().appendLine(line))
}

function stopWatching(): void {
  watcher?.dispose()
  watcher = undefined
}

/**
 * Relance manuelle. Elle passe par `Watcher.runNow`, donc exactement par le même chemin
 * que la sauvegarde : pas de seconde implémentation de la boucle.
 */
async function runStepCommand(): Promise<void> {
  if (watcher === undefined) await startWatching()
  if (watcher === undefined) {
    void vscode.window.showErrorMessage(
      'LearnPath — aucun parcours en cours dans ce dossier. Importe un parcours pour commencer.'
    )
    return
  }
  await watcher.runNow()
}

/** Le panneau n'existe qu'attaché à une session : sans parcours, il n'a rien à montrer. */
async function openCommand(): Promise<void> {
  if (watcher === undefined) await startWatching()
  if (watcher === undefined) {
    void vscode.window.showErrorMessage(
      'LearnPath — aucun parcours en cours dans ce dossier. Importe un parcours pour commencer.'
    )
    return
  }
  watcher.show()
}

/**
 * Deux choix, et le dialogue dit **dans son texte** que le code de l'utilisateur n'est
 * jamais touché : c'est exactement la peur qu'on a le doigt sur le bouton, et elle doit
 * être levée là, pas dans une documentation que personne n'ouvre.
 */
async function resetCommand(): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders?.[0]
  if (workspace === undefined) {
    void vscode.window.showErrorMessage("LearnPath — ouvre d'abord un dossier de projet.")
    return
  }
  const root = workspace.uri.fsPath

  const RESTART = 'Recommencer depuis l’étape 1'
  const REMOVE = 'Supprimer le parcours'
  const answer = await vscode.window.showWarningMessage('LearnPath — réinitialiser le parcours ?', {
    modal: true,
    detail: [
      'Ton code n’est jamais touché : ces deux actions ne modifient que le dossier .learn/.',
      '',
      `• ${RESTART} : la progression repart à zéro, les tests du parcours restent en place.`,
      `• ${REMOVE} : tout le dossier .learn/ est supprimé — parcours, tests et progression.`,
    ].join('\n'),
  }, RESTART, REMOVE)
  if (answer === undefined) return

  if (answer === RESTART) {
    const restarted = await restartParcours(root)
    if (!restarted.ok) {
      void vscode.window.showErrorMessage(`LearnPath — ${restarted.error}`)
      return
    }
    await startWatching()
    watcher?.show()
    void vscode.window.showInformationMessage(
      `LearnPath — progression réinitialisée : retour à l'étape ${restarted.value}. Ton code n'a pas été touché.`
    )
    return
  }

  const removed = await removeParcours(root)
  if (!removed.ok) {
    void vscode.window.showErrorMessage(`LearnPath — ${removed.error}`)
    return
  }
  stopWatching()
  ParcoursPanel.current?.dispose()
  void vscode.window.showInformationMessage(
    'LearnPath — le dossier .learn/ a été supprimé. Ton code n’a pas été touché.'
  )
}

async function importCommand(): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders?.[0]
  if (workspace === undefined) {
    void vscode.window.showErrorMessage('LearnPath — ouvre d\'abord un dossier de projet.')
    return
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'Importer',
    filters: { 'Parcours LearnPath': ['json'] },
  })
  const file = picked?.[0]
  if (file === undefined) return

  let raw: unknown
  try {
    raw = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(file)).toString('utf8'))
  } catch (error) {
    void vscode.window.showErrorMessage(
      `LearnPath — le fichier n'est pas du JSON valide : ${error instanceof Error ? error.message : String(error)}`
    )
    return
  }

  const parcours = loadParcours(raw)
  if (!parcours.ok) {
    // Les messages du lot 1 sont déjà en français et contextualisés par étape : on les
    // affiche tels quels, jamais une stack.
    const channel = log()
    channel.appendLine(`Parcours refusé : ${file.fsPath}`)
    for (const error of parcours.error) channel.appendLine(`  • ${error.message}`)
    channel.show(true)
    void vscode.window.showErrorMessage(
      `LearnPath — parcours invalide (${parcours.error.length} problème(s)). Détail dans la vue Sortie.`
    )
    return
  }

  const channel = log()
  const result = await importParcours(parcours.value, workspace.uri.fsPath, {
    confirm: (commands) => confirmSetup(commands),
    log: (line) => channel.append(line.endsWith('\n') ? line : `${line}\n`),
  })

  if (!result.ok) {
    void vscode.window.showErrorMessage(`LearnPath — ${result.error}`)
    return
  }
  void vscode.window.showInformationMessage(
    `LearnPath — parcours « ${result.value.slug} » importé : ${result.value.writtenFiles.length} fichiers dans .learn/.`
  )
  await startWatching()
  watcher?.show()
}

/** La boîte affiche les commandes exactes, telles qu'elles seront exécutées. */
async function confirmSetup(commands: readonly string[]): Promise<boolean> {
  const answer = await vscode.window.showWarningMessage(
    "LearnPath va exécuter les commandes d'installation du parcours :",
    { modal: true, detail: commands.join('\n') },
    'Exécuter'
  )
  return answer === 'Exécuter'
}

function log(): vscode.OutputChannel {
  output ??= vscode.window.createOutputChannel('LearnPath')
  return output
}
