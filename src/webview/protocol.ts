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
  | { readonly type: 'revealHint'; readonly stepId: string }
  | { readonly type: 'revealSolution'; readonly stepId: string }

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
    case 'revealHint':
      return typeof stepId === 'string' ? { type: 'revealHint', stepId } : undefined
    case 'revealSolution':
      return typeof stepId === 'string' ? { type: 'revealSolution', stepId } : undefined
    default:
      return undefined
  }
}
