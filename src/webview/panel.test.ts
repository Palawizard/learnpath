import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ViewModel } from '../core/viewmodel.js'
import { renderHeader, renderMain, renderStatus, renderWelcome } from './render.js'
import { renderMarkdown } from './markdown.js'
import { renderShell } from './shell.js'
import { parseWebviewMessage } from './protocol.js'
import { renderPromptPage } from './prompt-form.js'

/**
 * Le panneau lui-même (`panel.ts`) n'est qu'un branchement `vscode` : ce qu'il y a à
 * tester, c'est ce qu'il rend et ce qu'il accepte. Les deux vivent hors de `vscode`.
 */

function model(overrides: Partial<ViewModel> = {}): ViewModel {
  return {
    parcoursTitle: 'Panier',
    stepId: '1.2',
    stepTitle: 'Ajouter un article',
    position: 2,
    total: 5,
    percent: 20,
    explanation: 'Une **explication**.',
    expectedFiles: ['src/panier.js'],
    contract: 'addItem(panier, item, qty = 1)',
    acceptance: ['Ajoute une ligne si absent', 'Incrémente qty si déjà présent'],
    hints: [],
    hintsRemaining: 2,
    solutionRevealed: false,
    solution: [],
    status: { kind: 'none', summary: '', advanced: false },
    running: false,
    regressions: [],
    finished: false,
    recap: [],
    currentPosition: 2,
    readOnly: false,
    ...overrides,
  }
}

describe('renderHeader', () => {
  it('affiche le titre, le compteur et une barre de progression accessible', () => {
    const html = renderHeader(model())
    expect(html).toContain('<h1>Panier</h1>')
    expect(html).toContain('Étape 2 / 5')
    expect(html).toContain('aria-valuenow="20"')
    // Une barre segmentée, un segment par étape : le compteur et la barre comptent enfin
    // la même chose (« Étape 2 / 5 » = un segment acquis, le deuxième en cours).
    expect(html.match(/class="segment/g)).toHaveLength(5)
    expect(html.match(/segment done/g)).toHaveLength(1)
    expect(html.match(/segment current/g)).toHaveLength(1)
  })

  it('remplit tous les segments en fin de parcours', () => {
    const html = renderHeader(model({ finished: true, percent: 100 }))
    expect(html.match(/segment done/g)).toHaveLength(5)
    expect(html).not.toContain('segment current')
  })

  it('remplace le compteur par la fin de parcours', () => {
    expect(renderHeader(model({ finished: true, percent: 100 }))).toContain('Parcours terminé — 5 étapes')
  })
})

describe('renderMain — bloc Attendu, indices, actions', () => {
  it('rend le contrat et les critères', () => {
    const html = renderMain(model())
    expect(html).toContain('Attendu')
    expect(html).toContain('src/panier.js')
    expect(html).toContain('addItem(panier, item, qty = 1)')
    expect(html).toContain('<li>Ajoute une ligne si absent</li>')
  })

  it("n'affiche aucun bloc d'indices tant qu'aucun n'est révélé", () => {
    expect(renderMain(model())).not.toContain('Indices')
  })

  it('affiche les indices révélés dans l\'ordre et le nombre restant', () => {
    const html = renderMain(model({ hints: ['premier', 'deuxième'], hintsRemaining: 1 }))
    expect(html.indexOf('premier')).toBeLessThan(html.indexOf('deuxième'))
    expect(html).toContain('Indice (1 restant)')
  })

  it("désactive le bouton d'indice quand il n'en reste plus", () => {
    expect(renderMain(model({ hintsRemaining: 0 }))).toContain('data-action="hint" disabled')
  })

  it("affiche la solution d'une étape à un fichier, avec chemin, code et bouton de copie", () => {
    const html = renderMain(
      model({
        solutionRevealed: true,
        solution: [{ file: 'src/panier.js', content: 'export const panier = []\n' }],
      })
    )
    expect(html).toContain('<code class="file">src/panier.js</code>')
    expect(html).toContain('data-action="copy" data-file="src/panier.js"')
    expect(html).toContain('<span class="tok-keyword">export</span>')
    // Le code s'affiche, il n'est pas écrit : le panneau le dit (D34).
    expect(html).toContain("rien n'a été écrit dans tes fichiers")
  })

  it('affiche un bloc par fichier quand une étape en touche plusieurs', () => {
    const html = renderMain(
      model({
        solutionRevealed: true,
        solution: [
          { file: 'src/panier.js', content: 'export const panier = []\n' },
          { file: 'src/total.js', content: 'export const total = 0\n' },
        ],
      })
    )
    expect(html.match(/class="solution-file"/g)).toHaveLength(2)
    expect(html).toContain('data-file="src/panier.js"')
    expect(html).toContain('data-file="src/total.js"')
    // Chaque fichier a son propre bloc de code, pas un pavé commun à redécouper.
    expect(html.match(/<pre class="code">/g)).toHaveLength(2)
  })

  it("n'affiche rien tant que la solution n'est pas révélée", () => {
    expect(renderMain(model())).not.toContain('class="solution-file"')
  })

  it('échappe le HTML de la solution au lieu de le rendre', () => {
    const html = renderMain(
      model({
        solutionRevealed: true,
        solution: [{ file: 'src/x.js', content: '// <script>alert(1)</script>' }],
      })
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('désactive le bouton Solution une fois la solution affichée', () => {
    const html = renderMain(model({ solutionRevealed: true }))
    expect(html).toContain('data-action="solution" disabled')
    expect(html).toContain('Solution affichée')
  })

  it('remplace les actions par le récapitulatif en fin de parcours', () => {
    const html = renderMain(
      model({
        finished: true,
        recap: [
          { id: '1.1', title: 'Créer un panier', hints: 0, solution: false },
          { id: '1.2', title: 'Ajouter un article', hints: 2, solution: false },
          { id: '1.3', title: 'Total', hints: 0, solution: true },
        ],
      })
    )
    expect(html).not.toContain('data-action=')
    expect(html).toContain('sans aide')
    expect(html).toContain('2 indices')
    expect(html).toContain('solution affichée')
  })

  it("ne garde que le récapitulatif en fin de parcours : l'énoncé de la dernière étape disparaît", () => {
    const html = renderMain(
      model({
        finished: true,
        stepTitle: 'Appliquer la remise',
        explanation: 'Le pourquoi de la dernière étape.',
        recap: [{ id: '1.1', title: 'Créer un panier', hints: 0, solution: false }],
      })
    )
    expect(html).not.toContain('Appliquer la remise')
    expect(html).not.toContain('Le pourquoi')
    expect(html).not.toContain('Attendu')
    expect(html).toContain('Récapitulatif')
  })

  it('échappe le contenu du parcours hors markdown', () => {
    const html = renderMain(model({ stepTitle: '<img src=x onerror=alert(1)>' }))
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
})

describe('renderStatus — les trois rouges', () => {
  it('missing-file : rien du tout', () => {
    expect(renderStatus(model())).toBe('')
  })

  it('collect-error : discret, jamais la classe failed', () => {
    const html = renderStatus(
      model({
        status: {
          kind: 'progress',
          summary: "Le fichier n'est pas encore valide.",
          detail: "SyntaxError: Unexpected token '}'",
          advanced: false,
        },
      })
    )
    expect(html).toContain('banner progress')
    expect(html).not.toContain('failed')
    expect(html).toContain("SyntaxError: Unexpected token &#39;}&#39;")
  })

  it('assertion-failed : rouge, nom du test et attendu / reçu', () => {
    const html = renderStatus(
      model({
        status: {
          kind: 'failed',
          summary: 'Test en échec : step 1.2 — ajout ajoute une ligne',
          testName: 'step 1.2 — ajout ajoute une ligne',
          detail: 'AssertionError: expected [ 1 ] to deeply equal []',
          advanced: false,
        },
      })
    )
    expect(html).toContain('banner failed')
    expect(html).toContain('step 1.2 — ajout ajoute une ligne')
    expect(html).toContain('expected [ 1 ] to deeply equal []')
    // Le nom du test n'apparaît qu'une fois, pas en doublon sous le résumé.
    expect(html.split('step 1.2 — ajout ajoute une ligne')).toHaveLength(2)
    expect(html).not.toContain('class="test-name"')
  })

  it('sort le nom du test quand le résumé ne le porte pas', () => {
    const html = renderStatus(
      model({
        status: { kind: 'failed', summary: 'Étape 1.2 : test en échec.', testName: 'step 1.2 — ajout', advanced: false },
      })
    )
    expect(html).toContain('<div class="test-name">step 1.2 — ajout</div>')
  })

  it('pass : vert, et flash seulement quand on vient d\'avancer', () => {
    const still = renderStatus(model({ status: { kind: 'passed', summary: 'ok', advanced: false } }))
    expect(still).toContain('banner passed')
    expect(still).not.toContain('flash')

    const moved = renderStatus(model({ status: { kind: 'passed', summary: 'ok', advanced: true } }))
    expect(moved).toContain('banner passed flash')
  })

  it('sort la régression dans son propre bandeau, séparé du statut', () => {
    const html = renderStatus(
      model({
        status: { kind: 'passed', summary: 'Étape 1.2 validée. En attente : 1.1.', advanced: false },
        regressions: [
          {
            stepId: '1.1',
            stepTitle: 'Créer un panier',
            testFile: '.learn/tests/step-1.1.spec.js',
            testName: 'step 1.1 — panier vide',
            detail: 'AssertionError: expected 3 to be 2',
          },
        ],
      })
    )
    const regression = html.indexOf('banner regression')
    const status = html.indexOf('banner passed')
    expect(regression).toBeGreaterThanOrEqual(0)
    expect(status).toBeGreaterThan(regression)
    expect(html).toContain('.learn/tests/step-1.1.spec.js')
    expect(html).toContain('step 1.1 — panier vide')
  })
})

describe('renderMarkdown — explanation traitée comme hostile', () => {
  const hostile = readFileSync('src/webview/__fixtures__/explication-hostile.md', 'utf8')
  const html = renderMarkdown(hostile)

  it('ne produit aucune balise brute du source', () => {
    expect(html).not.toContain('<script')
    // Aucun gestionnaire d'événement en attribut : les `onerror`/`onclick` du source
    // ressortent comme du texte échappé, jamais dans une balise.
    expect(html).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i)
    expect(html).not.toContain('<div')
    // Le HTML brut n'est pas filtré après coup : il n'est pas parsé, il sort en texte.
    expect(html).toContain('&lt;script&gt;')
  })

  it("ne produit aucune image, ni en data: ni distante — la CSP l'interdit de toute façon", () => {
    expect(html).not.toContain('<img')
    // Le `data:` reste visible, mais en texte : aucune balise ne le charge.
    expect(html).not.toMatch(/<[a-z]+[^>]*\ssrc\s*=/i)
  })

  it('refuse javascript: et data: dans les liens, en les laissant en texte', () => {
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('href="data:')
    expect(html).toContain('un lien javascript')
  })

  it('garde les liens http et le markdown utile', () => {
    expect(html).toContain('<a href="https://exemple.invalid/doc"')
    expect(html).toContain('<strong>gras</strong>')
    expect(html).toContain('<li>premier</li>')
    expect(html).toContain('<code>')
  })

  it('échappe le code, y compris les chevrons dans un bloc', () => {
    expect(html).toContain('1 &lt; 2 &amp;&amp; 3 &gt; 2')
  })
})

describe('renderShell', () => {
  const html = renderShell('N0NCE')

  it('maintient une CSP en default-src none, sans image ni police distante', () => {
    expect(html).toContain("default-src 'none'")
    expect(html).toContain("style-src 'nonce-N0NCE'")
    expect(html).toContain("script-src 'nonce-N0NCE'")
    expect(html).not.toContain('img-src')
    expect(html).not.toContain('font-src')
    expect(html).not.toContain('connect-src')
  })

  it('expose la zone d\'état comme région aria-live', () => {
    expect(html).toContain('id="status" role="status" aria-live="polite"')
  })

  it("n'utilise que des variables de thème pour les couleurs", () => {
    const style = html.slice(html.indexOf('<style'), html.indexOf('</style>'))
    // Aucun #hex, aucun rgb() : le thème contrasté a le sien.
    expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(style).not.toMatch(/\brgba?\(/)
  })

  it('ne donne jamais le focus depuis la webview', () => {
    expect(html).not.toContain('.focus(')
    expect(html).not.toContain('autofocus')
  })
})

describe("renderWelcome — l'état d'accueil, sans parcours", () => {
  const html = renderWelcome()

  it("dit ce que fait l'extension et offre le bouton d'import", () => {
    expect(html).toContain('Aucun parcours dans ce projet')
    expect(html).toContain('à chaque sauvegarde')
    expect(html).toContain('data-action="import"')
    expect(html).toContain('Importer un parcours')
  })

  it('compose le prompt depuis l’extension, sans renvoyer à une copie à recopier', () => {
    expect(html).toContain('data-action="generatePrompt"')
    expect(html).toContain('Générer le prompt')
    expect(html).not.toContain('http')
  })
})

describe('renderPromptPage — le formulaire de génération du prompt', () => {
  const html = renderPromptPage('N0NCE', undefined)

  it('demande les trois champs, et rend le seul obligatoire obligatoire', () => {
    expect(html).toContain('id="feature"')
    expect(html).toContain('required')
    expect(html).toContain('value="débutant"')
    expect(html).toContain('value="intermédiaire"')
    expect(html).toContain('id="files"')
  })

  it('affiche le prompt en entier, modifiable, avec le bouton de copie', () => {
    // Le point non négociable : un formulaire qui masque ce qu'on envoie retire toute
    // prise le jour où le résultat déçoit.
    expect(html).toMatch(/<textarea id="prompt"/)
    expect(html).toContain('id="copy"')
    expect(html).toContain('Copier')
  })

  it('garde la CSP du panneau et porte le nonce', () => {
    expect(html).toContain("default-src 'none'")
    expect(html).toContain("script-src 'nonce-N0NCE'")
    expect(html).toContain('<style nonce="N0NCE">')
  })

  it('signale un projet non JS/TS sans rien bloquer', () => {
    const withNotice = renderPromptPage('N0NCE', 'Pas de package.json')
    expect(withNotice).toContain('Pas de package.json')
    expect(withNotice).toContain('<form id="form">')
    expect(html).not.toContain('package.json')
  })
})

describe('parseWebviewMessage — frontière de confiance', () => {
  it('accepte les messages du protocole', () => {
    expect(parseWebviewMessage({ type: 'ready' })).toEqual({ type: 'ready' })
    expect(parseWebviewMessage({ type: 'import' })).toEqual({ type: 'import' })
    expect(parseWebviewMessage({ type: 'generatePrompt' })).toEqual({ type: 'generatePrompt' })
    expect(parseWebviewMessage({ type: 'revealHint', stepId: '1.2' })).toEqual({
      type: 'revealHint',
      stepId: '1.2',
    })
    expect(parseWebviewMessage({ type: 'revealSolution', stepId: '1.2' })).toEqual({
      type: 'revealSolution',
      stepId: '1.2',
    })
    expect(parseWebviewMessage({ type: 'review', stepId: '1.1' })).toEqual({
      type: 'review',
      stepId: '1.1',
    })
    expect(parseWebviewMessage({ type: 'reviewExit' })).toEqual({ type: 'reviewExit' })
    expect(parseWebviewMessage({ type: 'redo', stepId: '1.1' })).toEqual({
      type: 'redo',
      stepId: '1.1',
    })
  })

  it('refuse tout le reste sans lever', () => {
    for (const raw of [
      undefined,
      null,
      'revealSolution',
      42,
      [],
      {},
      { type: 'revealHint' },
      { type: 'revealHint', stepId: 12 },
      { type: 'revealSolution', stepId: { toString: () => '1.2' } },
      { type: 'importer' },
      { type: 'generatePrompts' },
      { type: 'redo' },
      { type: 'redo', stepId: 3 },
      { type: 'review', stepId: ['1.1'] },
      { type: 'refaire', stepId: '1.1' },
      { type: 'writeFile', path: '../../.bashrc' },
    ]) {
      expect(parseWebviewMessage(raw)).toBeUndefined()
    }
  })

  it('ne recopie aucun champ hors protocole', () => {
    expect(parseWebviewMessage({ type: 'revealHint', stepId: '1.2', file: '/etc/passwd' })).toEqual({
      type: 'revealHint',
      stepId: '1.2',
    })
  })
})

describe('renderStatus — run en cours et traduction des erreurs', () => {
  it('annonce le run et périme visiblement ce qui reste affiché', () => {
    const html = renderStatus(
      model({
        running: true,
        status: {
          kind: 'failed',
          summary: 'Test en échec : step 1.2',
          detail: 'AssertionError: expected [ 1 ] to deeply equal []',
          advanced: false,
        },
      })
    )
    expect(html).toContain('Tests en cours')
    expect(html).toContain('banner failed stale')
  })

  it("ne dit rien du run quand il n’y en a pas", () => {
    expect(renderStatus(model({ status: { kind: 'passed', summary: 'ok', advanced: false } }))).not.toContain(
      'Tests en cours'
    )
  })

  it('met la traduction devant et replie le brut, sans jamais le perdre', () => {
    const html = renderStatus(
      model({
        status: {
          kind: 'failed',
          summary: 'Test en échec : step 1.1',
          detail: 'TypeError: (0 , __vite_ssr_import_1__.createPanier) is not a function',
          explained: "« createPanier » n’est pas une fonction.",
          advanced: false,
        },
      })
    )
    expect(html).toContain('class="explained"')
    expect(html).toContain('Message brut de Vitest')
    expect(html).toContain('__vite_ssr_import_1__')
  })

  it("affiche le brut seul quand la forme n’est pas reconnue", () => {
    const html = renderStatus(
      model({
        status: { kind: 'progress', summary: 'x', detail: 'Erreur jamais vue', advanced: false },
      })
    )
    expect(html).toContain('Erreur jamais vue')
    expect(html).not.toContain('<details')
  })
})

describe('renderMain — relire une étape passée, et refaire une étape', () => {
  const review = {
    stepId: '1.1',
    review: {
      previousStepId: undefined,
      nextStepId: '1.2',
      redo: { stepId: '1.1', files: ['src/panier.js'], available: true },
    },
    readOnly: true,
    position: 1,
    currentPosition: 3,
  }

  it('annonce la lecture seule et propose la navigation, sans indice ni solution', () => {
    const html = renderMain(model(review))

    expect(html).toContain('Lecture seule')
    expect(html).toContain('data-action="review" data-step="1.2"')
    expect(html).toContain('data-action="reviewExit"')
    // Les gestes de l'étape courante n'existent pas ici.
    expect(html).not.toContain('data-action="hint"')
    expect(html).not.toContain('data-action="solution"')
  })

  it('nomme les fichiers remplacés avant même la confirmation', () => {
    const html = renderMain(model(review))

    expect(html).toContain('Refaire cette étape')
    expect(html).toContain('src/panier.js')
    expect(html).toContain('data-action="redo" data-step="1.1"')
    // Le libellé annonce une boîte de dialogue, pas une écriture immédiate.
    expect(html).toContain('Refaire l’étape 1.1…'.replace('’', "'"))
  })

  it('indisponible : l\'explication s\'affiche et le bouton n\'existe pas', () => {
    const html = renderMain(
      model({
        ...review,
        review: {
          ...review.review,
          redo: {
            stepId: '1.1',
            files: ['src/panier.js'],
            available: false,
            reason: "Ce projet n'est pas un dépôt git.",
          },
        },
      })
    )

    // Le texte est échappé comme tout le reste : on cherche la partie sans apostrophe.
    expect(html).toContain('pas un dépôt git.')
    expect(html).not.toContain('data-action="redo"')
  })

  it('l\'entrée en relecture est un lien discret, séparé des actions de l\'étape', () => {
    const html = renderMain(model({ reviewEntry: '1.1' }))

    expect(html).toContain('data-action="review" data-step="1.1"')
    expect(html).toContain('Relire une étape passée')
    expect(html).toContain("lecture seule, rien n'est modifié")
  })

  it('sans étape validée, aucune entrée en relecture', () => {
    expect(renderMain(model())).not.toContain('data-action="review"')
  })

  it('la barre de progression suit le parcours, pas l\'étape relue', () => {
    const html = renderHeader(model(review))

    expect(html).toContain('Relecture — étape 1 / 5')
    // Deux étapes acquises : la troisième est l'étape courante.
    expect(html.match(/segment done/g)).toHaveLength(2)
    expect(html).toContain('segment current')
  })
})
