import * as vscode from 'vscode'
import {
  type Outcome,
  type Session,
  RunLoop,
  isWatched,
  loadSession,
  runCurrentStep,
} from './core/progression'
import { applyTestsMove, detectTestsDir, planTestsMove } from './core/finish'
import { applySolution, revealNextHint } from './core/reveal'
import { buildViewModel } from './core/viewmodel'
import { ParcoursPanel } from './webview/panel'
import type { WebviewMessage } from './webview/protocol'

/**
 * Câblage de l'événement et rien d'autre : le debounce, l'annulation et toute la décision
 * de progression vivent dans `src/core/progression.ts`, sans `vscode`.
 */
export class Watcher implements vscode.Disposable {
  private session: Session
  /** Dernier run affiché. Sert à reconstruire le panneau après un clic ou un réaffichage. */
  private lastOutcome: Outcome | undefined
  /** Un run est en cours. Le panneau doit le dire dès la fin du debounce. */
  private running = false
  private readonly loop: RunLoop
  private readonly subscriptions: vscode.Disposable[] = []

  constructor(
    session: Session,
    private readonly log: (line: string) => void
  ) {
    this.session = session
    this.loop = new RunLoop({
      debounceMs: () => config().get<number>('debounceMs', 500),
      execute: (signal) => this.runOnce(signal),
    })

    this.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (document.uri.scheme !== 'file') return
        if (!isWatched(this.session, document.uri.fsPath)) return
        this.loop.schedule()
      })
    )
  }

  /** Ouvre la session du workspace, ou explique pourquoi il n'y en a pas. */
  static async open(workspaceRoot: string, log: (line: string) => void): Promise<Watcher | undefined> {
    const session = await loadSession(workspaceRoot)
    if (!session.ok) {
      log(session.error)
      return undefined
    }
    return new Watcher(session.value, log)
  }

  /** `learnpath.runStep` : même chemin que la sauvegarde, sans le debounce. */
  runNow(): Promise<void> {
    return this.loop.runNow()
  }

  /** Ouvre le panneau (sans lui donner le focus) et le branche sur cette session. */
  show(): void {
    const panel = ParcoursPanel.show()
    panel.onMessage((message) => void this.handle(message))
    this.refresh()
  }

  /** Pousse l'état courant au panneau s'il est ouvert. Ne l'ouvre jamais de lui-même. */
  private refresh(): void {
    const model = buildViewModel(
      this.session.parcours,
      this.session.state,
      this.lastOutcome,
      this.running
    )
    if (model === undefined) return
    ParcoursPanel.current?.update(model)
  }

  /**
   * Les deux gestes du panneau. `stepId` vient de la webview : on le compare à l'étape
   * courante et on ignore tout le reste, plutôt que de s'en servir pour aller chercher
   * une étape.
   */
  private async handle(message: WebviewMessage): Promise<void> {
    if (message.type === 'ready') return
    if (message.stepId !== this.session.state.currentStepId) return

    if (message.type === 'revealHint') {
      const revealed = await revealNextHint(this.session)
      if (!revealed.ok) {
        this.log(revealed.error)
        return
      }
      this.session = revealed.value
      this.refresh()
      return
    }

    await this.revealSolution()
  }

  /** Confirmation neutre : elle dit ce qui va être écrit, elle ne juge pas. */
  private async revealSolution(): Promise<void> {
    const stepId = this.session.state.currentStepId
    const step = this.session.parcours.steps.find((s) => s.id === stepId)
    if (step === undefined) return

    const answer = await vscode.window.showInformationMessage(
      `Afficher la solution de l'étape ${step.id} ?`,
      {
        modal: true,
        detail: `${Object.keys(step.solution).join(', ')} sera écrit avec la solution, et l'étape apparaîtra comme révélée dans le récapitulatif de fin.`,
      },
      'Afficher la solution'
    )
    if (answer !== 'Afficher la solution') return

    const applied = await applySolution(this.session)
    if (!applied.ok) {
      this.log(applied.error)
      void vscode.window.showErrorMessage(`LearnPath — ${applied.error}`)
      return
    }
    this.session = applied.value.session
    for (const file of applied.value.files) this.log(`solution écrite → ${file}`)
    this.refresh()
    // L'écriture par `fs` ne déclenche pas `onDidSaveTextDocument` : on relance nous-mêmes.
    await this.loop.runNow()
  }

  private async runOnce(signal: AbortSignal): Promise<void> {
    // Le debounce est passé, les tests partent : on le dit avant d'attendre la seconde de
    // Vitest, sinon on laisse regarder le rouge de la tentative précédente comme s'il
    // était à jour.
    this.running = true
    this.refresh()

    let outcome
    try {
      outcome = await runCurrentStep(this.session, {
        signal,
        autoAdvance: config().get<boolean>('autoAdvance', true),
      })
    } finally {
      this.running = false
    }
    // Un run annulé par une nouvelle sauvegarde ne doit rien afficher : le suivant parle,
    // et il vient d'être programmé — l'indicateur reste allumé par le run suivant.
    if (signal.aborted) return

    if (!outcome.ok) {
      this.log(outcome.error)
      ParcoursPanel.current?.showError(outcome.error)
      return
    }
    this.session = { ...this.session, state: outcome.value.state }
    this.lastOutcome = outcome.value
    this.report(outcome.value)
  }

  private report(outcome: Outcome): void {
    if (outcome.summary !== '') this.log(outcome.summary)
    this.refresh()

    if (outcome.advanced) {
      void vscode.window.setStatusBarMessage(`LearnPath — ${outcome.summary}`, 5000)
    }
    if (outcome.finished) void this.finish()
  }

  private async finish(): Promise<void> {
    const answer = await vscode.window.showInformationMessage(
      'LearnPath — parcours terminé.',
      { modal: true, detail: 'Les tests du parcours peuvent être déplacés dans le dossier de tests du projet pour être conservés.' },
      'Déplacer les tests',
      'Les laisser dans .learn/'
    )
    if (answer !== 'Déplacer les tests') return

    const detected = await detectTestsDir(this.session.root)
    const target =
      detected ??
      (await vscode.window.showInputBox({
        title: 'Dossier de destination des tests',
        prompt: 'Chemin relatif au projet. Aucun dossier de tests évident n\'a été trouvé.',
        value: 'tests',
        validateInput: (value) => (value.trim() === '' ? 'Indique un dossier.' : undefined),
      }))
    if (target === undefined) return

    const plan = await planTestsMove(this.session.root, target.trim())
    if (!plan.ok) {
      void vscode.window.showErrorMessage(`LearnPath — ${plan.error}`)
      return
    }

    // Ces fichiers sont hors `.learn/` : on montre la liste exacte avant d'écrire.
    const confirmed = await vscode.window.showWarningMessage(
      `LearnPath va déplacer ${plan.value.length} fichier(s) vers ${target.trim()} :`,
      { modal: true, detail: plan.value.map((move) => move.label).join('\n') },
      'Déplacer'
    )
    if (confirmed !== 'Déplacer') return

    const moved = await applyTestsMove(plan.value)
    if (!moved.ok) {
      void vscode.window.showErrorMessage(`LearnPath — ${moved.error}`)
      return
    }
    for (const label of moved.value) this.log(`déplacé → ${label}`)
    void vscode.window.showInformationMessage(
      `LearnPath — ${moved.value.length} fichier(s) de test déplacés vers ${target.trim()}.`
    )
  }

  dispose(): void {
    this.loop.dispose()
    for (const subscription of this.subscriptions.splice(0)) subscription.dispose()
  }
}

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('learnpath')
}
