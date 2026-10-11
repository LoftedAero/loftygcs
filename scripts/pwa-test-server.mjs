// Serves the production build at both deployment paths. A simulated release
// changes the HTML revision so browser tests exercise a real waiting worker.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'

const root = resolve('dist-web')
let release = 0
let fail = false
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
}
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/__test/release' && req.method === 'POST') {
    release++
    fail = url.searchParams.has('fail')
    res.end('ok')
    return
  }
  if (url.pathname === '/__test/idle') {
    res.setHeader('Content-Type', 'text/html')
    res.end('<title>Outside app scope</title>')
    return
  }
  const relative = decodeURIComponent(url.pathname)
    .replace(/^\/nested\/gcs\//, '/')
    .slice(1)
  const file = resolve(root, relative || 'index.html')
  if (!file.startsWith(root + '/')) {
    res.writeHead(403).end()
    return
  }
  try {
    if (fail && relative === 'index.html') throw new Error('Interrupted deployment')
    let content = await readFile(file)
    if (relative === 'sw.js' && release) {
      const original = content.toString()
      const updated = original.replace(/(url:"index.html",revision:")[^"]+/, `$1test-${release}`)
      if (updated === original) throw new Error('Missing index.html revision in generated worker')
      content = Buffer.from(updated)
    }
    res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-store')
    res.end(content)
  } catch {
    res.writeHead(404).end()
  }
}).listen(4173, '127.0.0.1')
