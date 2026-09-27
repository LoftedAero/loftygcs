/// <reference types="vitest/config" />
import { cpSync, existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// CesiumJS fetches its workers, shaders and widget CSS at runtime from
// CESIUM_BASE_URL, so they cannot be bundled: they are served from
// node_modules in dev and copied beside the output at build. The single-file
// demo build has its own config without this; the replay is lazy-loaded, so
// it still works there.
const CESIUM_DIRS = ['Assets', 'ThirdParty', 'Widgets', 'Workers']
// The prebuilt bundle, loaded by a script tag because Cesium's ESM source
// does not survive tree-shaking (see LogReplay.tsx).
const CESIUM_FILES = ['Cesium.js']

function cesiumAssets(): Plugin {
  const require = createRequire(import.meta.url)
  let source = ''
  try {
    source = path.join(path.dirname(require.resolve('cesium')), 'Build', 'Cesium')
  } catch {
    // Cesium not installed: the replay reports it instead of the build failing.
  }
  return {
    name: 'loftgcs:cesium-assets',
    configureServer(server) {
      if (!source) return
      server.middlewares.use('/cesium', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0] ?? '')
        const file = path.join(source, rel)
        // Never serve outside the Cesium build directory.
        if (!file.startsWith(source) || !existsSync(file)) return next()
        res.setHeader('Cache-Control', 'no-cache')
        void import('node:fs').then((fs) => fs.createReadStream(file).pipe(res))
      })
    },
    closeBundle() {
      if (!source) return
      const out = path.resolve('dist-web', 'cesium')
      for (const dir of CESIUM_DIRS) {
        const from = path.join(source, dir)
        if (existsSync(from)) cpSync(from, path.join(out, dir), { recursive: true })
      }
      for (const file of CESIUM_FILES) {
        const from = path.join(source, file)
        if (existsSync(from)) cpSync(from, path.join(out, file))
      }
    },
  }
}

// base './' so the same build works from a static host at any path and from
// file:// inside the packaged Electron app.
export default defineConfig({
  base: './',
  plugins: [react(), cesiumAssets()],
  // glTF is not a Vite asset type by default. Models are imported with ?url
  // so the demo build can inline them.
  assetsInclude: ['**/*.gltf'],
  define: {
    // The version comes from package.json, which npm exposes to scripts.
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
  build: {
    outDir: 'dist-web',
    // Matches the tsconfig target, and supports the module worker.
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    // Stubs for browser APIs jsdom lacks.
    setupFiles: ['./src/test-setup.ts'],
    // One file at a time against SITL: it accepts a single TCP client and
    // exits when it leaves, so parallel files fight over the slot and fail
    // with "could not reach SITL" while the simulator is healthy.
    fileParallelism: process.env.SITL !== '1',
  },
})
