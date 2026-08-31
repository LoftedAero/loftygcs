/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the same build works from a static host at any path AND from
// file:// inside the packaged Electron app -- one build, two homes.
export default defineConfig({
  base: './',
  plugins: [react()],
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
