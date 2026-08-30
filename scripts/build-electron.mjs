// Production build: renderer via Vite, then main + preload via esbuild.
// Two esbuild calls instead of a Vite Electron plugin: fewer moving parts,
// and the electron/ sources are small enough that a bundler config would be
// bigger than the code.
import { build as viteBuild } from 'vite'
import { buildSync } from 'esbuild'

await viteBuild()

buildSync({
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
})

console.log('Electron build complete: dist-web/ + dist-electron/')
