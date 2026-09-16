/** Extension → webview. */
export interface HostMessage {
  readonly type: 'render'
  /** Étape affichée. La webview le renvoie tel quel dans ses messages. */
  readonly stepId: string
  readonly header: string
  readonly main: string
  readonly status: string
}

/** Webview → extension. Frontière de confiance : tout passe par `parseWebviewMessage`. */
export type WebviewMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'import' }
  | { readonly type: 'generatePrompt' }
  | { readonly type: 'revealHint'; readonly stepId: string }
  | { readonly type: 'revealSolution'; readonly stepId: string }
  | { readonly type: 'copySolution'; readonly stepId: string; readonly file: string }
  /** Afficher le squelette de l'étape courante (D41). N'écrit que le state. */
  | { readonly type: 'revealScaffold'; readonly stepId: string }
  | { readonly type: 'copyScaffold'; readonly stepId: string; readonly file: string }
  /** Relire une étape passée, en lecture seule : n'écrit rien, jamais. */
  | { readonly type: 'review'; readonly stepId: string }
  /** Quitter la relecture et revenir à l'étape en cours. */
  | { readonly type: 'reviewExit' }
  /** Refaire une étape passée : le seul message qui mène à une écriture hors de `.learn/`. */
  | { readonly type: 'redo'; readonly stepId: string }

/**
 * Le contenu vient de notre propre script, mais le canal, lui, est une frontière : on
 * valide la forme avant usage et on ignore tout le reste. `stepId` est comparé à l'étape
 * courante par l'appelant, il n'est jamais utilisé pour construire un chemin.
 */
export function parseWebviewMessage(raw: unknown): WebviewMessage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const message = raw as Record<string, unknown>
  const stepId = message['stepId']

  switch (message['type']) {
    case 'ready':
      return { type: 'ready' }
    case 'import':
      return { type: 'import' }
    case 'generatePrompt':
      return { type: 'generatePrompt' }
    case 'revealHint':
      return typeof stepId === 'string' ? { type: 'revealHint', stepId } : undefined
    case 'review':
      return typeof stepId === 'string' ? { type: 'review', stepId } : undefined
    case 'reviewExit':
      return { type: 'reviewExit' }
    // `stepId` est comparé aux étapes validées du parcours par l'appelant, et les chemins
    // restaurés viennent de `expected.files` de cette étape — jamais de la webview.
    case 'redo':
      return typeof stepId === 'string' ? { type: 'redo', stepId } : undefined
    case 'revealSolution':
      return typeof stepId === 'string' ? { type: 'revealSolution', stepId } : undefined
    case 'revealScaffold':
      return typeof stepId === 'string' ? { type: 'revealScaffold', stepId } : undefined
    case 'copySolution':
    case 'copyScaffold': {
      // `file` sert de clé dans `step.solution` ou `step.scaffold`, jamais à construire un chemin.
      const file = message['file']
      return typeof stepId === 'string' && typeof file === 'string'
        ? { type: message['type'], stepId, file }
        : undefined
    }
    default:
      return undefined
  }
}
