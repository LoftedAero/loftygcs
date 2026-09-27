// Production build: renderer via Vite, then main + preload via esbuild
// directly rather than through a Vite Electron plugin.
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
