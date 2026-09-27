// The browser half of `npm run cal-art`: draw an airframe in each of the six
// compass-calibration attitudes and return one sprite sheet per aircraft.
//
// Runs in an Electron window (see make-cal-art.mjs) and produces a committed
// asset, so the Sensors page does not need three.js and WebGL for six static
// 64px pictures.
//
// The pivot rotation, normalization, repaint and held yaw match the live
// renderer, because the accel-calibration wizard draws the same aircraft in
// the same six attitudes with a real three.js scene.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { ROTATION_COUNT, boardRotation } from '../src/protocol/board-rotation.ts'

const HALF = Math.PI / 2

/** Matches `REPAINT` in src/ui/components/VehicleView.tsx. */
const REPAINT = {
  body_paint: 0xb4b7bf,
  metal: 0x5f636b,
  wood: 0x9c7b4e,
}

/**
 * In `ORIENTATIONS` order (src/protocol/cal-orientation.ts), which is the
 * frame order in the sheet. Roll right and pitch up are positive, as in
 * ArduPilot.
 */
const FRAMES = [
  { id: 'level', roll: 0, pitch: 0 },
  { id: 'leftSide', roll: -HALF, pitch: 0 },
  { id: 'rightSide', roll: HALF, pitch: 0 },
  { id: 'noseDown', roll: 0, pitch: -HALF },
  { id: 'tailDown', roll: 0, pitch: HALF },
  { id: 'upsideDown', roll: Math.PI, pitch: 0 },
]

/** Held yaw, so the airframe is seen at three-quarters. AccelVehicleView's. */
const PRESENTATION_YAW = -0.62

/** The live view's viewing direction: a little from above. */
const VIEW_DIR = new THREE.Vector3(0, 0.42, 1).normalize()

/** How much of the frame the widest attitude is allowed to fill. */
const FILL = 0.94

/**
 * Dimmer than the live view so a small tile keeps its outline against a white
 * card. Light directions match the live view; PAINT darkens every material,
 * including the F-35B's near-white paint.
 */
const AMBIENT = 1.35
const KEY = 1.7
const FILL_LIGHT = 0.65
const PAINT = 0.78

function rotationFor({ roll, pitch }) {
  // VehicleView's mapping from ArduPilot body frame into three.js.
  return new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(pitch, -PRESENTATION_YAW, -roll, 'YXZ'),
  )
}

function load(loader, source) {
  return new Promise((resolve, reject) => {
    // Parsed from memory: a file:// URL would taint the canvas, and
    // toDataURL on a tainted canvas throws.
    loader.parse(source, '', (gltf) => resolve(gltf.scene), reject)
  })
}

/** Every vertex in world space, which is what the framing below measures. */
function worldVertices(model) {
  model.updateMatrixWorld(true)
  const out = []
  const v = new THREE.Vector3()
  model.traverse((obj) => {
    const position = obj.isMesh ? obj.geometry?.attributes?.position : null
    if (!position) return
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(obj.matrixWorld)
      out.push(v.clone())
    }
  })
  return out
}

/**
 * One camera distance that fits all six attitudes. The live view fits the
 * bounding sphere because its attitude is arbitrary; here the six are known,
 * so the projected extent is measured, which frames the aircraft much tighter.
 */
function fitDistance(camera, verts) {
  const mats = FRAMES.map(rotationFor)
  let distance = 3
  const p = new THREE.Vector3()
  for (let iter = 0; iter < 10; iter++) {
    camera.position.copy(VIEW_DIR.clone().multiplyScalar(distance))
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    camera.updateProjectionMatrix()
    let extent = 0
    for (const m of mats) {
      for (const v of verts) {
        p.copy(v).applyMatrix4(m).project(camera)
        extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y))
      }
    }
    if (Math.abs(extent - FILL) < 0.002) break
    // Not linear in distance, so it converges rather than solves.
    distance *= extent / FILL
  }
  return distance
}

/**
 * Render one aircraft's sheet: six frames left to right, `frame` pixels each.
 * Supersampled and scaled down, since MSAA alone leaves thin edges jagged at
 * this size.
 */
async function sheet(source, frame, scale) {
  const big = frame * scale
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(1)
  renderer.setSize(big, big, false)

  const scene = new THREE.Scene()
  scene.add(new THREE.AmbientLight(0xffffff, AMBIENT))
  const key = new THREE.DirectionalLight(0xffffff, KEY)
  key.position.set(4, 8, 6)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xffffff, FILL_LIGHT)
  fill.position.set(-6, 2, -4)
  scene.add(fill)

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
  const pivot = new THREE.Group()
  scene.add(pivot)

  const model = await load(new GLTFLoader(), source)
  const box = new THREE.Box3().setFromObject(model)
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  model.position.sub(sphere.center)
  model.scale.setScalar(1 / (sphere.radius || 1))
  model.traverse((obj) => {
    const materials = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : []
    for (const material of materials) {
      if (!material.color) continue
      const repaint = REPAINT[material.name]
      if (repaint !== undefined) material.color.setHex(repaint)
      material.color.multiplyScalar(PAINT)
    }
  })
  pivot.add(model)

  const distance = fitDistance(camera, worldVertices(model))
  camera.position.copy(VIEW_DIR.clone().multiplyScalar(distance))
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()

  const out = document.createElement('canvas')
  out.width = frame * FRAMES.length
  out.height = frame
  const ctx = out.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  for (let i = 0; i < FRAMES.length; i++) {
    pivot.rotation.set(FRAMES[i].pitch, -PRESENTATION_YAW, -FRAMES[i].roll, 'YXZ')
    renderer.render(scene, camera)
    ctx.drawImage(renderer.domElement, 0, 0, big, big, i * frame, 0, frame, frame)
  }

  const url = out.toDataURL('image/png')
  renderer.dispose()
  return { url, distance }
}

/**
 * About 40 degrees down rather than the aircraft tiles' 23: the board's
 * arrows and the silhouette are flat and foreshorten badly from a shallow
 * angle.
 */
const BOARD_VIEW_DIR = new THREE.Vector3(0, 0.85, 1).normalize()

/** Board frames per row of the orientation sheet: 44 rotations in 11 x 4. */
export const BOARD_COLUMNS = 11

const GROUND_Y = -0.53

/** Triangles in the XZ plane at height y, from [x, z] triples, wound to face up or down. */
function flat(tris, y, faceUp, material) {
  const pos = []
  for (const tri of tris) {
    const ordered = faceUp ? tri : [tri[0], tri[2], tri[1]]
    for (const [x, z] of ordered) pos.push(x, y, z)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return new THREE.Mesh(geo, material)
}

/** The board's arrow: forward is -Z. One-sided, so it is culled when turned away. */
function arrow(y, faceUp, material) {
  const a = 0.035
  return flat(
    [
      [[0, -0.27], [-0.14, -0.02], [0.14, -0.02]],
      [[-a, -0.02], [-a, 0.2], [a, 0.2]],
      [[-a, -0.02], [a, 0.2], [a, -0.02]],
    ],
    y,
    faceUp,
    material,
  )
}

/** A flat airplane on the ground, nose forward: the vehicle the board is in. */
function silhouette() {
  const outline = [
    [24, 3], [25.8, 4.6], [26.9, 7.4], [27.3, 10.5], [27.6, 20], [45, 29], [45, 32.5],
    [27.6, 28], [27.6, 37], [31.5, 41.5], [31.5, 44], [24, 41.8], [16.5, 44], [16.5, 41.5],
    [20.4, 37], [20.4, 28], [3, 32.5], [3, 29], [20.4, 20], [20.7, 10.5], [21.1, 7.4],
    [22.2, 4.6],
  ]
  const shape = new THREE.Shape()
  outline.forEach(([x, y], i) => {
    const X = ((x - 24) / 21) * 0.62
    // Local +Y becomes world -Z once the mesh is laid flat, so the nose is forward.
    const Y = ((23.5 - y) / 20.5) * 0.7
    if (i === 0) shape.moveTo(X, Y)
    else shape.lineTo(X, Y)
  })
  shape.closePath()
  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color: 0xcdd1d8, side: THREE.DoubleSide }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = GROUND_Y
  return mesh
}

/**
 * The autopilot board: a slab with a forward arrow on each face, blue with a
 * white arrow on top and charcoal with a grey arrow underneath, so a board
 * mounted face down still shows its direction and which side is up.
 */
function buildBoard() {
  const g = new THREE.Group()
  const W = 0.5
  const T = 0.06
  const L = 0.66
  const FACE = T / 2 + 0.002
  const top = new THREE.MeshStandardMaterial({ color: 0x3f7cc0, roughness: 0.85 })
  const side = new THREE.MeshStandardMaterial({ color: 0x33669f, roughness: 0.85 })
  const under = new THREE.MeshStandardMaterial({ color: 0x2d2f33, roughness: 0.9 })
  // BoxGeometry face groups: +x, -x, +y, -y, +z, -z.
  g.add(new THREE.Mesh(new THREE.BoxGeometry(W, T, L), [side, side, top, under, side, side]))
  g.add(arrow(FACE, true, new THREE.MeshBasicMaterial({ color: 0xffffff })))
  g.add(arrow(-FACE, false, new THREE.MeshBasicMaterial({ color: 0x9aa1ab })))
  return g
}

/**
 * The board in every fixed AHRS_ORIENTATION, one frame per enum value. The
 * silhouette underneath is the frame of reference; without it a rotated board
 * looks like the same board seen from another angle.
 */
async function boardSheet(frame, scale) {
  const big = frame * scale
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(big, big, false)

  const scene = new THREE.Scene()
  scene.add(new THREE.AmbientLight(0xffffff, AMBIENT))
  const key = new THREE.DirectionalLight(0xffffff, KEY)
  key.position.set(4, 8, 6)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xffffff, FILL_LIGHT)
  fill.position.set(-6, 2, -4)
  scene.add(fill)

  // The whole rig turns to the tiles' three-quarter view; the board turns
  // inside it, relative to a vehicle whose forward is -Z.
  const world = new THREE.Group()
  world.rotation.y = -PRESENTATION_YAW
  scene.add(world)
  world.add(silhouette())
  const board = buildBoard()
  world.add(board)

  // Every board rotation (0.63 at most) and the silhouette's tail (0.81) fit
  // within this radius of a point just below the board, so one distance
  // frames all 44 as tightly as possible.
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
  const distance = 0.86 / Math.sin((camera.fov * Math.PI) / 360)
  camera.position.copy(BOARD_VIEW_DIR.clone().multiplyScalar(distance))
  camera.position.y -= 0.12
  camera.lookAt(0, -0.12, 0)
  camera.updateProjectionMatrix()

  const rows = Math.ceil(ROTATION_COUNT / BOARD_COLUMNS)
  const out = document.createElement('canvas')
  out.width = frame * BOARD_COLUMNS
  out.height = frame * rows
  const ctx = out.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  for (let value = 0; value < ROTATION_COUNT; value++) {
    const r = boardRotation(value)
    // VehicleView's mapping from ArduPilot body frame into three.js.
    board.rotation.set(r.pitch, -r.yaw, -r.roll, 'YXZ')
    renderer.render(scene, camera)
    const x = (value % BOARD_COLUMNS) * frame
    const y = Math.floor(value / BOARD_COLUMNS) * frame
    ctx.drawImage(renderer.domElement, 0, 0, big, big, x, y, frame, frame)
  }

  const url = out.toDataURL('image/png')
  renderer.dispose()
  return { url, distance, columns: BOARD_COLUMNS, rows }
}

/** Called from the main process. One sheet per aircraft, as data URLs. */
export async function render({ planeGltf, f35bBase64, frame, boardFrame, scale }) {
  const bytes = Uint8Array.from(atob(f35bBase64), (c) => c.charCodeAt(0))
  return {
    frames: FRAMES.map((f) => f.id),
    plane: await sheet(planeGltf, frame, scale),
    f35b: await sheet(bytes.buffer, frame, scale),
    board: await boardSheet(boardFrame, scale),
  }
}
