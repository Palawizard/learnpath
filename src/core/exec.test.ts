import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { launcher, vitestCli } from './exec.js'

describe('launcher', () => {
  const windows = process.platform === 'win32'

  it('hors Windows, ne touche à rien', () => {
    if (windows) return
    expect(launcher('npm', ['i', '-D', 'vitest'])).toEqual({ file: 'npm', args: ['i', '-D', 'vitest'] })
  })

  it('sous Windows, lance npm par le Node courant plutôt que npm.cmd', () => {
    if (!windows) return
    const launch = launcher('npm', ['i', '-D', 'vitest'])
    expect(launch.file).toBe(process.execPath)
    expect(launch.args[0]).toMatch(/npm-cli\.js$/)
    expect(launch.args.slice(1)).toEqual(['i', '-D', 'vitest'])
  })

  it("sous Windows, trouve pnpm sans passer par pnpm.cmd quand il est installé", () => {
    if (!windows) return
    const launch = launcher('pnpm', ['add', '-D', 'vitest'])
    // Machine sans pnpm : on n'a rien inventé, la commande ressort telle quelle.
    if (launch.file === 'pnpm') return
    expect(launch.file === process.execPath || launch.file.endsWith('pnpm.exe')).toBe(true)
    expect(launch.file.endsWith('.cmd')).toBe(false)
    expect(launch.args.slice(launch.file === process.execPath ? 1 : 0)).toEqual(['add', '-D', 'vitest'])
  })

  it("laisse passer un binaire qu'on ne sait pas relancer par Node", () => {
    expect(launcher('binaire-qui-nexiste-pas', ['install'])).toEqual({
      file: 'binaire-qui-nexiste-pas',
      args: ['install'],
    })
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
