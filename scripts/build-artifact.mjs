// Build the shareable single-file demo of the app.
//
// Produces two things in dist-demo/:
//   index.html    -- the whole app in one file (JS, CSS, worker inlined);
//                    open it anywhere a static file serves.
//   artifact.html -- the same content as a body fragment (no doctype/html/
//                    head/body), which is the form the Claude artifact host
//                    wants -- it wraps fragments in its own skeleton.
//
// In the artifact sandbox only same-origin + a short CDN allowlist load, so
// OSM map tiles and the param-metadata fetch fail there (both degrade
// gracefully); demo mode needs neither.
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
    // The single file has no server to fetch from, so the 3D models have to
    // travel inside it. They are the reason this limit is measured in
    // megabytes rather than kilobytes.
    assetsInlineLimit: 4_000_000,
  },
})

const html = readFileSync(path.resolve('dist-demo/index.html'), 'utf8')

// Keep only what the artifact skeleton doesn't provide: title, the Google
// Fonts links (on the artifact CSP allowlist), the inlined styles and the
// inlined module script, plus the app's mount point.
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
