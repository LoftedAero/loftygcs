// Pre-render the compass-calibration attitude art:
//
//   npm run cal-art
//
// Writes one sprite sheet per aircraft into src/ui/tabs/sensors/, six frames
// left to right in `ORIENTATIONS` order, plus the board orientation sheet.
// cal-art-scene.mjs does the drawing; this bundles it, runs it in an Electron
// window (the same renderer as the live airframe) and saves the result.
//
// Models are passed as strings because a file:// image taints the canvas and
// toDataURL then throws.
import { app, BrowserWindow } from 'electron'
import * as esbuild from 'esbuild'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Pixels per frame. Twice the 72px the tiles draw, for a 2x display. */
const FRAME = 144

/** Pixels per frame of the board sheet. Twice the 160px the card draws it at. */
const BOARD_FRAME = 320

/** Supersampling: each frame is rendered this much larger, then scaled down. */
const SCALE = 3

const OUT = 'src/ui/tabs/sensors'

async function render() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'loftgcs-cal-art-'))
  try {
    // three.js arrives as bare specifiers, so the scene has to be bundled
    // before a plain file:// page can run it.
    await esbuild.build({
      entryPoints: [path.join(root, 'scripts/cal-art-scene.mjs')],
      outfile: path.join(tmp, 'scene.js'),
      bundle: true,
      format: 'iife',
      globalName: 'CalArt',
      platform: 'browser',
      target: 'chrome130',
      legalComments: 'none',
    })

    const page = path.join(tmp, 'page.html')
    writeFileSync(
      page,
      `<!doctype html><meta charset="utf-8"><body style="margin:0"><script src="scene.js"></script>`,
    )

    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
    await win.loadFile(page)

    const input = {
      planeGltf: readFileSync(path.join(root, 'src/models/airplane.gltf'), 'utf8'),
      f35bBase64: readFileSync(path.join(root, 'src/models/f35b.glb')).toString('base64'),
      frame: FRAME,
      boardFrame: BOARD_FRAME,
      scale: SCALE,
    }
    const result = await win.webContents.executeJavaScript(
      `CalArt.render(${JSON.stringify(input)})`,
    )

    for (const [name, sheet] of [
      ['cal-attitudes-plane.png', result.plane],
      ['cal-attitudes-f35b.png', result.f35b],
    ]) {
      const png = Buffer.from(sheet.url.slice(sheet.url.indexOf(',') + 1), 'base64')
      // A WebGL context that failed to draw still yields a valid, nearly
      // empty PNG, so size is the check.
      if (png.length < 4000) throw new Error(`${name} came back empty (${png.length} bytes)`)
      writeFileSync(path.join(root, OUT, name), png)
      console.log(
        `wrote ${OUT}/${name}  ${FRAME * result.frames.length}x${FRAME}, ` +
          `${Math.round(png.length / 1024)} KB, camera at ${sheet.distance.toFixed(2)}`,
      )
    }
    console.log(`frames: ${result.frames.join(', ')}`)

    const board = result.board
    const boardPng = Buffer.from(board.url.slice(board.url.indexOf(',') + 1), 'base64')
    if (boardPng.length < 4000)
      throw new Error(`board sheet came back empty (${boardPng.length} bytes)`)
    writeFileSync(path.join(root, OUT, 'board-orientations.png'), boardPng)
    console.log(
      `wrote ${OUT}/board-orientations.png  ${BOARD_FRAME * board.columns}x${BOARD_FRAME * board.rows}, ` +
        `${Math.round(boardPng.length / 1024)} KB, ${board.columns} x ${board.rows} frames`,
    )
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
      console.error(`could not render the calibration art: ${err?.stack ?? err}`)
      app.exit(1)
    },
  )
