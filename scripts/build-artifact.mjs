// Builds the single-file demo into dist-demo/:
//   index.html    the whole app in one file (JS, CSS and worker inlined).
//   artifact.html the same content as a body fragment, for hosts that wrap
//                 fragments in their own document skeleton.
//
// Sandboxed hosts block OSM tiles and the parameter metadata fetch; both
// degrade gracefully and demo mode needs neither.
import { build } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

await build({
  configFile: false, // the demo build defines itself; don't merge vite.config.ts
  base: './',
  plugins: [react(), viteSingleFile()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
  assetsInclude: ['**/*.gltf'],
  build: {
    outDir: 'dist-demo',
    target: 'es2022',
    // Large enough to inline the 3D models, since there is no server to fetch them from.
    assetsInlineLimit: 4_000_000,
  },
})

const html = readFileSync(path.resolve('dist-demo/index.html'), 'utf8')

// Keep only what the host skeleton doesn't provide: title, font links, the
// inlined styles and module script, and the mount point.
const pick = (re) => [...html.matchAll(re)].map((m) => m[0]).join('\n')
const title = pick(/<title>[\s\S]*?<\/title>/g)
const fontLinks = pick(/<link[^>]+(?:fonts\.googleapis|fonts\.gstatic)[^>]*>/g)
const styles = pick(/<style[\s\S]*?<\/style>/g)
const scripts = pick(/<script type="module"[\s\S]*?<\/script>/g)

const fragment = `${title}
${fontLinks}
<style>
  /* The artifact composites over the host's ground; paint our own. */
  html, body { background: #F1F2F5; }
</style>
${styles}
<div id="root"></div>
${scripts}
`

writeFileSync(path.resolve('dist-demo/artifact.html'), fragment)
console.log(
  `dist-demo/artifact.html: ${(fragment.length / 1024 / 1024).toFixed(1)} MB fragment ready`,
)
