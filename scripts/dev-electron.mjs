// Development loop for the Electron shell: Vite dev server for the renderer
// (full HMR), esbuild for main + preload, then Electron pointed at the dev
// URL. Changes under electron/ need a rerun of this script -- they change
// the privileged surface, which deserves a restart rather than a hot patch.
import { createServer } from 'vite'
import { buildSync } from 'esbuild'
import { spawn } from 'node:child_process'
import electronPath from 'electron'

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

const server = await createServer()
await server.listen()
const url = server.resolvedUrls.local[0]
console.log(`Vite dev server: ${url}`)

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
})

child.on('exit', async () => {
  await server.close()
  process.exit(0)
})
