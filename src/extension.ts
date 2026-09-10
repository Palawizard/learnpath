import * as vscode from 'vscode'
import * as path from 'node:path'
import { loadParcours } from './core/parcours'
import { importParcours } from './core/importer'
import { removeParcours, restartParcours } from './core/reset'
import { ParcoursPanel } from './webview/panel'
import { PromptPanel } from './webview/prompt-panel'
import { Watcher } from './watcher'

let output: vscode.OutputChannel | undefined
let watcher: Watcher | undefined

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('LearnPath')
  mergeTerminalPath()
  context.subscriptions.push(
    output,
    ParcoursPanel.register(),
    { dispose: () => stopWatching() },
    vscode.commands.registerCommand('learnpath.open', () => void openCommand()),
    vscode.commands.registerCommand('learnpath.import', () => void importCommand()),
    vscode.commands.registerCommand(
      'learnpath.generatePrompt',
      () => void PromptPanel.show(context.extensionUri)
    ),
    vscode.commands.registerCommand('learnpath.runStep', () => void runStepCommand()),
    vscode.commands.registerCommand('learnpath.reset', () => void resetCommand()),
  )
  // Le panneau s'ouvre tout seul quand il y a un parcours : c'est l'objet de l'extension.
  // `ParcoursPanel.show` ne prend pas le focus, l'utilisateur reste dans son éditeur.
  void startWatching().then(() => watcher?.show())
}

/**
 * D29 : l'hôte d'extension n'a pas le PATH d'un terminal — avec nvm, fnm ou volta, `npm`
 * marche dans le terminal et donne `spawn npm ENOENT` à l'import. `src/core` n'importe pas
 * `vscode` : on ajoute donc ici, en queue de PATH, ce que l'utilisateur a réglé dans
 * `terminal.integrated.env.*`, et la résolution de `exec.ts` le voit comme le reste. En
 * queue : le PATH de l'hôte reste prioritaire.
 */
function mergeTerminalPath(): void {
  const key = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'
  const env = vscode.workspace.getConfiguration('terminal.integrated.env').get<Record<string, string>>(key)
  const extra = env?.['PATH'] ?? env?.['Path']
  if (extra === undefined) return

  const current = (process.env['PATH'] ?? '').split(path.delimiter)
  const missing = extra
    .split(path.delimiter)
    .filter((dir) => dir !== '' && !dir.includes('${env:') && !current.includes(dir))
  if (missing.length === 0) return
  process.env['PATH'] = [...current, ...missing].join(path.delimiter)
}

export function deactivate(): void {
  stopWatching()
}

/** Un seul watcher vivant : réimporter ou changer de parcours remplace l'abonnement. */
async function startWatching(): Promise<void> {
  stopWatching()
  const root = vscode.workspace.workspaceFolders?.[0]
  if (root !== undefined) {
    watcher = await Watcher.open(root.uri.fsPath, (line) => log().appendLine(line))
  }
  setActive(watcher !== undefined)
}

/**
 * Un parcours est en cours, ou pas. Le contexte commande les deux actions du titre de la
 * vue (Relancer, Réinitialiser) ; sans parcours, la vue montre son état d'accueil plutôt
 * que de rester vide — c'est le seul endroit d'où on peut importer sans connaître la
 * palette.
 */
function setActive(active: boolean): void {
  void vscode.commands.executeCommand('setContext', 'learnpath.active', active)
  if (!active) ParcoursPanel.current?.showWelcome()
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

/** Sans parcours, la vue s'ouvre quand même : elle montre l'accueil, d'où on importe. */
async function openCommand(): Promise<void> {
  if (watcher === undefined) await startWatching()
  if (watcher === undefined) {
    ParcoursPanel.show()
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
  const REMOVE = 'Supprimer le parcours (garder le JSON généré)'
  const answer = await vscode.window.showWarningMessage('LearnPath — réinitialiser le parcours ?', {
    modal: true,
    detail: [
      'Ton code n’est jamais touché : ces deux actions ne modifient que le dossier .learn/.',
      '',
      `• ${RESTART} : la progression repart à zéro, les tests du parcours restent en place.`,
      `• ${REMOVE} : progression, tests et config sont supprimés. Le ou les fichiers de`,
      `  parcours générés restent dans .learn/parcours/ — les régénérer coûterait un`,
      `  aller-retour à ton agent, alors qu'il suffit de les réimporter.`,
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
  setActive(false)
  void vscode.window.showInformationMessage(
    removed.value.length === 0
      ? 'LearnPath — le dossier .learn/ a été supprimé. Ton code n’a pas été touché.'
      : `LearnPath — progression et tests supprimés. Le parcours généré est conservé (${removed.value.join(', ')}) : réimporte-le pour le rejouer sans le régénérer. Ton code n’a pas été touché.`
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
    // D36 : le point de départ git n'est posé que si l'utilisateur laisse l'option active.
    gitCheckpoints: vscode.workspace.getConfiguration('learnpath').get<boolean>('gitCheckpoints', true),
  })

  if (!result.ok) {
    // Le message peut être long (diagnostic de résolution de commande, D29) : la
    // notification n'en montre qu'une ligne, la vue Sortie le donne en entier.
    channel.appendLine(result.error)
    channel.show(true)
    void vscode.window.showErrorMessage(`LearnPath — ${result.error.split('\n')[0] ?? ''}`)
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
