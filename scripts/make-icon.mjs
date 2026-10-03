// Rasterize public/icons/icon.svg into every image the apps ship:
//
//   build/icon.png   the source electron-builder turns into a Windows .ico and
//                    a macOS .icns
//   android/...      the Android launcher icons and launch splash screens
//
//   npm run icon
//
// Uses Electron rather than an image library: it is already a dependency and
// is the same renderer that draws the SVG inside the app.
import { app, BrowserWindow } from 'electron'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RES = path.join(root, 'android/app/src/main/res')

/** The window background, --la-bg, behind the splash mark. */
const SPLASH_BG = '#F1F2F5'

/**
 * What to draw: an image `w` by `h` with the mark centered in a square
 * `mark` px wide, on `bg` or transparent.
 */
function outputs() {
  const list = [{ file: path.join(root, 'build/icon.png'), w: 512, h: 512, mark: 512 }]
  if (!existsSync(RES)) return list
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
  for (const [d, k] of Object.entries(densities)) {
    // Launchers before Android 8 show these as they are. The mark is round,
    // so the same image serves the square and round slots.
    const legacy = Math.round(48 * k)
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
      list.push({
        file: path.join(RES, `mipmap-${d}`, name),
        w: legacy,
        h: legacy,
        mark: Math.round(legacy * 0.92),
      })
    }
    // Adaptive icons: a 108 dp layer that launchers mask to their own shape,
    // showing at least the middle 66 dp. The mark is sized to sit inside it.
    const layer = Math.round(108 * k)
    list.push({
      file: path.join(RES, `mipmap-${d}`, 'ic_launcher_foreground.png'),
      w: layer,
      h: layer,
      mark: Math.round(layer * 0.64),
    })
    // Launch splash screens, both orientations.
    const short = Math.round(320 * k)
    const long = Math.round(480 * k)
    const sizes = {
      hdpi: [480, 800],
      xhdpi: [720, 1280],
      xxhdpi: [960, 1600],
      xxxhdpi: [1280, 1920],
    }
    const [s, l] = sizes[d] ?? [short, long]
    list.push({
      file: path.join(RES, `drawable-port-${d}`, 'splash.png'),
      w: s,
      h: l,
      mark: Math.round(s * 0.3),
      bg: SPLASH_BG,
    })
    list.push({
      file: path.join(RES, `drawable-land-${d}`, 'splash.png'),
      w: l,
      h: s,
      mark: Math.round(s * 0.3),
      bg: SPLASH_BG,
    })
  }
  list.push({
    file: path.join(RES, 'drawable', 'splash.png'),
    w: 480,
    h: 320,
    mark: 96,
    bg: SPLASH_BG,
  })
  return list
}

/**
 * - Draws onto a canvas instead of using capturePage, which waits for a
 *   compositor frame that a hidden window never produces.
 * - The page is a real file, because a data: document has an opaque origin.
 * - The SVG is loaded as a data: URI, because a file:// image taints the
 *   canvas and toDataURL then throws.
 */
async function render() {
  const svg = readFileSync(path.join(root, 'public/icons/icon.svg'), 'utf8')
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'loftgcs-icon-'))
  try {
    const page = path.join(tmp, 'page.html')
    writeFileSync(page, `<!doctype html><meta charset="utf-8"><body style="margin:0"></body>`)
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
    await win.loadFile(page)
    await win.webContents.executeJavaScript(`
      window.draw = (svg, w, h, mark, bg) => new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
          const c = document.createElement('canvas')
          c.width = w
          c.height = h
          const ctx = c.getContext('2d')
          ctx.clearRect(0, 0, w, h)
          if (bg) {
            ctx.fillStyle = bg
            ctx.fillRect(0, 0, w, h)
          }
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(img, (w - mark) / 2, (h - mark) / 2, mark, mark)
          try { resolve(c.toDataURL('image/png')) } catch (e) { reject(e) }
        }
        img.onerror = () => reject(new Error('the SVG failed to decode'))
        // Drawn from the vector at every size, never scaled from a bitmap.
        img.src = 'data:image/svg+xml;charset=utf-8,' +
          encodeURIComponent(svg.replace('<svg ', '<svg width="' + mark + '" height="' + mark + '" '))
      })
      true
    `)

    for (const o of outputs()) {
      const dataUrl = await win.webContents.executeJavaScript(
        `window.draw(${JSON.stringify(svg)}, ${o.w}, ${o.h}, ${o.mark}, ${JSON.stringify(o.bg ?? null)})`,
      )
      const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
      if (png.length < 200)
        throw new Error(`suspiciously small PNG for ${o.file} (${png.length} bytes)`)
      mkdirSync(path.dirname(o.file), { recursive: true })
      writeFileSync(o.file, png)
      console.log(`wrote ${path.relative(root, o.file)}  ${o.w}x${o.h}`)
    }
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
      // Otherwise the hidden window keeps the process alive and a failure
      // hangs silently.
      console.error(`could not render the icon: ${err?.message ?? err}`)
      app.exit(1)
    },
  )
