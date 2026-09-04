/// <reference types="vitest/config" />
import { cpSync, existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// CesiumJS needs a handful of directories served alongside the bundle --
// its web workers, its shaders and its widget CSS -- which it fetches at
// runtime from CESIUM_BASE_URL rather than importing. They cannot be
// bundled, so they are served from node_modules in dev and copied beside
// the output at build.
//
// Thirty lines here rather than a plugin dependency, for the same reason
// the Electron build is two esbuild calls: the config would be bigger than
// the code. It also means the single-file demo build, which defines its own
// config, simply does not have this -- and the replay is lazy-loaded, so
// that build works without it.
const CESIUM_DIRS = ['Assets', 'ThirdParty', 'Widgets', 'Workers']

function cesiumAssets(): Plugin {
  const require = createRequire(import.meta.url)
  let source = ''
  try {
    source = path.join(path.dirname(require.resolve('cesium')), 'Build', 'Cesium')
  } catch {
    // Cesium not installed: the replay will say so rather than the build
    // failing for everyone who never opens it.
  }
  return {
    name: 'loftgcs:cesium-assets',
    configureServer(server) {
      if (!source) return
      server.middlewares.use('/cesium', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0] ?? '')
        const file = path.join(source, rel)
        // Never serve outside the Cesium build directory, whatever the URL
        // asked for.
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
    },
  }
}

// base './' so the same build works from a static host at any path AND from
// file:// inside the packaged Electron app -- one build, two homes.
export default defineConfig({
  base: './',
  plugins: [react(), cesiumAssets()],
  // glTF is not a Vite asset type by default; the 3D models are imported
  // with ?url so the demo build can inline them and the web build can serve
  // them as separate files.
  assetsInclude: ['**/*.gltf'],
  define: {
    // Single source of truth for the version string is package.json; npm
    // exposes it to any script it runs.
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
  build: {
    outDir: 'dist-web',
    // The protocol worker (Phase 1) will be a module worker; ES2022 output
    // matches the tsconfig target so there is no down-leveling surprise.
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    // Stubs for the browser APIs jsdom lacks; see the file for why they are
    // here rather than guarded for in the components themselves.
    setupFiles: ['./src/test-setup.ts'],
  },
})
