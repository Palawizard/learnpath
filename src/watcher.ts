import * as vscode from 'vscode'
import * as path from 'node:path'
import {
  type Outcome,
  type Session,
  RunLoop,
  isWatched,
  loadSession,
  runCurrentStep,
} from './core/progression'
import { applyTestsMove, detectTestsDir, planTestsMove } from './core/finish'
import { revealCurrentSolution, revealNextHint } from './core/reveal'
import { applyRedo, planRedo, validatedCount } from './core/redo'
import { buildViewModel } from './core/viewmodel'
import type { RedoView } from './core/viewmodel'
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
  /** Étape relue en lecture seule, s'il y en a une. Ne change rien à la progression. */
  private review: { readonly stepId: string; readonly redo: RedoView } | undefined
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

  /** Révèle la vue (sans lui donner le focus) et la branche sur cette session. */
  show(): void {
    ParcoursPanel.show()
    ParcoursPanel.current?.onMessage((message) => void this.handle(message))
    this.refresh()
  }

  /** Pousse l'état courant au panneau s'il est ouvert. Ne l'ouvre jamais de lui-même. */
  private refresh(): void {
    const model = buildViewModel(
      this.session.parcours,
      this.session.state,
      this.lastOutcome,
      this.running,
      this.review
    )
    if (model === undefined) return
    ParcoursPanel.current?.update(model)
  }

/**
   * Les gestes du panneau. `stepId` vient de la webview : pour l'étape courante il est
   * comparé au state et rien d'autre n'en est tiré ; pour la relecture et la reprise, il
   * est cherché parmi les étapes **validées** du parcours, et seuls les `expected.files`
   * de l'étape trouvée servent ensuite.
   */
  private async handle(message: WebviewMessage): Promise<void> {
    // `ready`, `import` et la composition du prompt sont traités par le panneau lui-même :
    // ils n'ont pas d'étape.
    if (message.type === 'ready' || message.type === 'import') return
    if (message.type === 'generatePrompt') return

    // Les trois gestes de la relecture portent une étape passée : ils ne se comparent pas
    // à l'étape courante.
    if (message.type === 'review') return this.openReview(message.stepId)
    if (message.type === 'reviewExit') {
      this.review = undefined
      this.refresh()
      return
    }
    if (message.type === 'redo') return this.redo(message.stepId)

    // En relecture, rien de ce qui suit n'est proposé à l'écran ; si un message arrive
    // quand même, il ne s'applique pas à l'étape qu'on regarde.
    if (this.review !== undefined) return
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

    if (message.type === 'copySolution') {
      await this.copySolution(message.file)
      return
    }

    await this.revealSolution()
  }

  /**
   * Confirmation neutre : elle dit ce qui va s'afficher, elle ne juge pas. Elle ne parle
   * plus d'écriture de fichier — la solution s'affiche dans le panneau et rien n'est écrit
   * dans le code de l'utilisateur (D34).
   */
  private async revealSolution(): Promise<void> {
    const stepId = this.session.state.currentStepId
    const step = this.session.parcours.steps.find((s) => s.id === stepId)
    if (step === undefined) return

    const files = Object.keys(step.solution)
    const answer = await vscode.window.showInformationMessage(
      `Afficher la solution de l'étape ${step.id} ?`,
      {
        modal: true,
        detail: `La solution de ${files.join(', ')} s'affichera dans le panneau, à recopier toi-même. Aucun de tes fichiers ne sera modifié. L'étape apparaîtra comme révélée dans le récapitulatif de fin.`,
      },
      'Afficher la solution'
    )
    if (answer !== 'Afficher la solution') return

    const revealed = await revealCurrentSolution(this.session)
    if (!revealed.ok) {
      this.log(revealed.error)
      void vscode.window.showErrorMessage(`LearnPath — ${revealed.error}`)
      return
    }
    this.session = revealed.value
    this.log(`solution affichée → ${files.join(', ')}`)
    this.refresh()
  }

  /**
   * Relire une étape passée. Lecture seule stricte : on ne touche ni au state, ni à un
   * fichier, ni au run en cours. Le seul appel git ici sert à savoir si « Refaire » sera
   * proposé, et pourquoi il ne le serait pas.
   */
  private async openReview(stepId: string): Promise<void> {
    const steps = this.session.parcours.steps
    const index = steps.findIndex((s) => s.id === stepId)
    const step = steps[index]
    if (step === undefined || index >= validatedCount(this.session)) return

    const plan = await planRedo(this.session, stepId, gitCheckpoints())
    this.review = {
      stepId,
      redo: plan.ok
        ? { stepId, files: plan.value.targets.map((target) => target.file), available: true }
        : { stepId, files: step.expected.files, available: false, reason: plan.error },
    }
    this.refresh()
  }

  /**
   * Refaire une étape : le seul geste du panneau qui écrit hors de `.learn/`, et il est
   * borné aux `expected.files` de l'étape visée (D36).
   *
   * Deux précautions avant d'écrire, dans cet ordre :
   * - la confirmation nomme chaque fichier et dit lequel est réécrit, lequel est supprimé ;
   * - les éditeurs modifiés non sauvegardés sont sauvegardés **d'abord**. VSCode ne
   *   recharge pas un buffer modifié : sans ça, l'utilisateur ne verrait pas la
   *   restauration et sa sauvegarde suivante l'écraserait — exactement le bug de D34. Ce
   *   qui est sauvegardé part dans l'instantané `refs/learnpath-backup/` pris juste après,
   *   donc rien n'est perdu sans recours.
   */
  private async redo(stepId: string): Promise<void> {
    const plan = await planRedo(this.session, stepId, gitCheckpoints())
    if (!plan.ok) {
      this.log(plan.error)
      void vscode.window.showErrorMessage(`LearnPath — ${plan.error}`)
      return
    }

    const targets = plan.value.targets
    const dirty = vscode.workspace.textDocuments.filter(
      (document) =>
        document.isDirty &&
        targets.some((target) => path.relative(target.path, document.uri.fsPath) === '')
    )
    const detail = [
      `Ces fichiers seront remplacés par leur contenu d'avant l'étape ${plan.value.step.id} :`,
      ...targets.map((target) =>
        target.action === 'delete'
          ? `• ${target.file} — supprimé : il n'existait pas encore à ce moment-là`
          : `• ${target.file}`
      ),
      '',
      ...(dirty.length === 0
        ? []
        : [
            `Modifications non sauvegardées dans ${dirty.map((d) => vscode.workspace.asRelativePath(d.uri)).join(', ')} : elles seront sauvegardées, puis remplacées.`,
            '',
          ]),
      "Aucun autre fichier n'est touché, et ta progression repart à cette étape.",
      'Un point de restauration git (refs/learnpath-backup/) est créé juste avant : rien de ce qui est remplacé ne sort de git.',
    ].join('\n')

    const CONFIRM = `Refaire l'étape ${plan.value.step.id}`
    const answer = await vscode.window.showWarningMessage(`LearnPath — refaire l'étape ${plan.value.step.id} ?`, { modal: true, detail }, CONFIRM)
    if (answer !== CONFIRM) return

    // Un run programmé ou en cours porte sur l'étape d'avant la reprise : on l'annule
    // plutôt que de le laisser écrire une avancée par-dessus le retour en arrière.
    this.loop.dispose()
    for (const document of dirty) await document.save()

    const applied = await applyRedo(this.session, plan.value)
    if (!applied.ok) {
      this.log(applied.error)
      void vscode.window.showErrorMessage(`LearnPath — ${applied.error}`)
      return
    }

    this.session = applied.value
    this.review = undefined
    // Le dernier run décrivait une autre étape : le garder afficherait un vert périmé.
    this.lastOutcome = undefined
    for (const target of targets) this.log(`${target.action === 'delete' ? 'supprimé' : 'restauré'} → ${target.file}`)
    this.refresh()
    void vscode.window.showInformationMessage(
      `LearnPath — retour à l'étape ${plan.value.step.id} : ${targets.length} fichier(s) restauré(s).`
    )
  }

  /** Le presse-papiers de l'hôte : la webview n'a pas à demander la permission. */
  private async copySolution(file: string): Promise<void> {
    const stepId = this.session.state.currentStepId
    const step = this.session.parcours.steps.find((s) => s.id === stepId)
    const content = step?.solution[file]
    if (content === undefined) return
    await vscode.env.clipboard.writeText(content)
    void vscode.window.setStatusBarMessage(`LearnPath — ${file} copié`, 3000)
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
        gitCheckpoints: gitCheckpoints(),
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
    // Le point de restauration a échoué : la progression, elle, n'a aucune raison de
    // s'arrêter. On le journalise, et la reprise de l'étape suivante se dira indisponible.
    if (outcome.checkpointError !== undefined) this.log(outcome.checkpointError)
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

/** Relue à chaque geste : couper l'option prend effet tout de suite, sans recharger. */
function gitCheckpoints(): boolean {
  return config().get<boolean>('gitCheckpoints', true)
}
