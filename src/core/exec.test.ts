import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { launcher, notFoundMessage, vitestCli } from './exec.js'

describe('launcher', () => {
  const windows = process.platform === 'win32'

  it('lance npm par le Node courant, sur les deux plateformes', () => {
    const launch = launcher('npm', ['i', '-D', 'vitest'])
    expect(launch.resolved).toBe(true)
    expect(launch.file).toBe(process.execPath)
    expect(launch.args[0]).toMatch(/npm-cli[.]js$/)
    expect(launch.args.slice(1)).toEqual(['i', '-D', 'vitest'])
  })

  // D29 : le bug remonté du terrain, « spawn npm ENOENT » alors que npm marche dans le
  // terminal. On casse le PATH pour de bon : la résolution doit tenir sans lui, par le
  // Node qui exécute l'hôte.
  it('trouve encore npm quand le PATH est vide (nvm, fnm, volta)', () => {
    const avant = process.env['PATH']
    try {
      process.env['PATH'] = ''
      const launch = launcher('npm', ['i', '-D', 'vitest'])
      expect(launch.resolved).toBe(true)
      expect(launch.file).toBe(process.execPath)
      expect(launch.args[0]).toMatch(/npm-cli[.]js$/)
    } finally {
      process.env['PATH'] = avant
    }
  })

  // L'autre moitié du même bug : quand le binaire n'est pas livré avec Node, tout repose
  // sur le PATH. Sous Windows, le shim est un .cmd que spawn refuse sans shell, et le JS
  // qu'il appelle s'appelle « <nom>-cli.js » chez npm et volta — l'ancienne résolution ne
  // cherchait que « <nom>.cjs/.js/.mjs » et ne trouvait donc rien.
  it('résout un binaire installé dans un dossier du PATH, .cmd compris', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'learnpath-path-'))
    const avant = process.env['PATH']
    try {
      const bin = path.join(dir, 'node_modules', 'pnpm', 'bin')
      await fs.mkdir(bin, { recursive: true })
      await fs.writeFile(path.join(bin, 'pnpm-cli.js'), '// cli')
      await fs.writeFile(path.join(dir, windows ? 'pnpm.cmd' : 'pnpm'), '', { mode: 0o755 })
      process.env['PATH'] = dir

      const launch = launcher('pnpm', ['add', '-D', 'vitest'])
      expect(launch.resolved).toBe(true)
      if (windows) {
        expect(launch.file).toBe(process.execPath)
        expect(launch.args[0]).toBe(path.join(bin, 'pnpm-cli.js'))
        expect(launch.args.slice(1)).toEqual(['add', '-D', 'vitest'])
      } else {
        expect(launch.file).toBe(path.join(dir, 'pnpm'))
        expect(launch.args).toEqual(['add', '-D', 'vitest'])
      }
    } finally {
      process.env['PATH'] = avant
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it("sous Windows, ne rend jamais un .cmd : spawn sans shell le refuse", () => {
    if (!windows) return
    for (const binary of ['npm', 'npx', 'pnpm', 'yarn']) {
      expect(launcher(binary, []).file.endsWith('.cmd')).toBe(false)
    }
  })

  it("dit qu'il n'a rien trouvé plutôt que de laisser passer un ENOENT", () => {
    const launch = launcher('binaire-qui-nexiste-pas', ['install'])
    expect(launch.resolved).toBe(false)
    expect(launch.tried.length).toBeGreaterThan(0)
  })
})

describe('notFoundMessage', () => {
  const launch = launcher('binaire-qui-nexiste-pas', ['install'])
  const text = notFoundMessage('binaire-qui-nexiste-pas install', launch)

  it("donne le diagnostic : chemins cherchés, execPath, PATH de l'hôte", () => {
    expect(text).toContain('Diagnostic')
    expect(text).toContain(launch.tried[0] ?? '(aucun)')
    expect(text).toContain(process.execPath)
    expect(text).toContain((process.env['PATH'] ?? '').split(path.delimiter)[0] ?? '')
  })

  it("propose la sortie de secours au lieu de laisser l'utilisateur bloqué", () => {
    expect(text).toContain('binaire-qui-nexiste-pas install')
    expect(text).toContain('dans un terminal')
    expect(text).toContain('"setup": []')
  })
})

describe('vitestCli', () => {
  it('trouve le CLI installé dans le projet', () => {
    const found = vitestCli(process.cwd())
    expect(found.ok).toBe(true)
    if (found.ok) {
      expect(found.value).toBe(path.join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs'))
    }
  })

  it("dit d'abord que Vitest n'est pas installé", () => {
    const found = vitestCli(os.tmpdir())
    expect(found.ok).toBe(false)
    if (!found.ok) expect(found.error).toContain('node_modules/vitest est introuvable')
  })

  it("reconnaît Yarn Plug'n'Play plutôt que de parler d'une installation ratée", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'learnpath-pnp-'))
    try {
      await fs.writeFile(path.join(dir, '.pnp.cjs'), '/* yarn pnp */\n')
      const found = vitestCli(dir)
      expect(found.ok).toBe(false)
      if (!found.ok) {
        expect(found.error).toContain("Plug'n'Play")
        expect(found.error).toContain('nodeLinker')
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
