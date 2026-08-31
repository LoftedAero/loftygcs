// Rasterise public/icons/icon.svg to build/icon.png, the source image
// electron-builder turns into a Windows .ico and a macOS .icns.
//
//   npm run icon
//
// Run through Electron rather than a rasteriser dependency: the project
// already has Electron, and this is the same renderer that draws the icon's
// SVG twin inside the app, so the two cannot disagree. Adding a native image
// library for a file that changes about once a year would cost more than it
// saves.
import { app, BrowserWindow } from 'electron'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SIZE = 512

/**
 * Three things here are deliberate, each of which cost an attempt:
 *
 *  - The image is drawn onto a canvas rather than captured off the window.
 *    capturePage waits for the compositor to produce a frame, and a window
 *    that is never shown never produces one -- it just hangs.
 *  - The page is a real file on disk, not a data: URL. A data: document is
 *    opaque-origin and loading anything into it is a fight.
 *  - The SVG reaches the page as a data: URI, not as a file. A file:// image
 *    taints the canvas, and toDataURL on a tainted canvas throws.
 */
async function render() {
  const svg = readFileSync(path.join(root, 'public/icons/icon.svg'), 'utf8')
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'loftgcs-icon-'))
  try {
    const html = `<!doctype html><meta charset="utf-8"><body style="margin:0"></body>`
    const page = path.join(tmp, 'page.html')
    writeFileSync(page, html)

    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
    await win.loadFile(page)

    const dataUrl = await win.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
          const c = document.createElement('canvas')
          c.width = c.height = ${SIZE}
          const ctx = c.getContext('2d')
          ctx.clearRect(0, 0, ${SIZE}, ${SIZE})
          ctx.drawImage(img, 0, 0, ${SIZE}, ${SIZE})
          try { resolve(c.toDataURL('image/png')) } catch (e) { reject(e) }
        }
        img.onerror = () => reject(new Error('the SVG failed to decode'))
        img.src = 'data:image/svg+xml;charset=utf-8,' +
          encodeURIComponent(${JSON.stringify(svg)})
      })
    `)

    const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
    if (png.length < 1000) throw new Error(`suspiciously small PNG (${png.length} bytes)`)
    mkdirSync(path.join(root, 'build'), { recursive: true })
    writeFileSync(path.join(root, 'build/icon.png'), png)
    console.log(`wrote build/icon.png  ${SIZE}x${SIZE}, ${Math.round(png.length / 1024)} KB`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

app
  .whenReady()
  .then(render)
  .then(
    () => app.exit(0),
    (err) => {
      // Without this an failure is invisible: the rejection is unhandled, the
      // window keeps the process alive, and it hangs with nothing on stdout.
      console.error(`could not render the icon: ${err?.message ?? err}`)
      app.exit(1)
    },
  )
