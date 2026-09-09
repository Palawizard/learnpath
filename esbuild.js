const esbuild = require('esbuild')

const watch = process.argv.includes('--watch')

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  // Le VSIX embarque ajv et markdown-it : sans minification le bundle fait 600 ko.
  // La source map, elle, ne part pas dans le paquet (.vscodeignore).
  minify: !watch,
  logLevel: 'info',
}

if (watch) {
  esbuild.context(options).then((ctx) => ctx.watch())
} else {
  esbuild.build(options).catch(() => process.exit(1))
}
