// The browser half of `npm run cal-art`: draw an airframe in each of the six
// compass-calibration attitudes and return one sprite sheet per aircraft.
//
// This runs inside an Electron window (see make-cal-art.mjs) rather than in
// the app, because the result is a committed asset: the calibration tiles are
// 64px and static, so paying for three.js, a GLTF parse and a WebGL context on
// the Sensors page to redraw the same six pictures every time would be a cost
// with nothing to show for it.
//
// Every convention here is copied from the live renderer on purpose -- the
// pivot rotation, the normalization, the lights, the repaint, the held yaw --
// because the accel-calibration wizard draws the same aircraft in the same six
// attitudes with a real three.js scene. If the two disagree, one screen
// contradicts another.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const HALF = Math.PI / 2

/** Matches `REPAINT` in src/ui/components/VehicleView.tsx. */
const REPAINT = {
  body_paint: 0xb4b7bf,
  metal: 0x5f636b,
  wood: 0x9c7b4e,
}

/**
 * The six, in `ORIENTATIONS` order (src/protocol/cal-orientation.ts) -- which
 * is the order of the frames in the sheet, so the component can index it.
 * Roll and pitch are ArduPilot's: roll right positive, pitch up positive.
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
 * Lighting, dimmer than the live view's, and why.
 *
 * VehicleView lights a model that fills a panel; these are 72px pictures that
 * have to hold an outline against a white card. At the live intensities the
 * airframe came out near white and the tile read as an empty box in the light
 * theme -- which is the theme it is most often looked at in. The *directions*
 * are the live view's, so the shading still says the same thing about which
 * way up the aircraft is; only the exposure changes, plus a shade off every
 * material so the F-35B's own near-white paint comes down with it.
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
    // Parsed from memory rather than fetched: a file:// URL would taint the
    // canvas, and toDataURL on a tainted canvas throws.
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
 * One camera distance that fits all six attitudes, found by measuring.
 *
 * The live view fits the model's bounding *sphere*, which is the only thing
 * that works when the attitude is arbitrary and changing. Here the six are
 * known, so the real projected extent can be measured instead -- and it is
 * much smaller than the sphere, because a sphere around a wingspan is mostly
 * empty air. Fitting the sphere at this size drew an aeroplane about half the
 * width of its tile.
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
 *
 * Supersampled and scaled down rather than rendered at size: these are 64px
 * pictures of a 30,000-triangle aeroplane, and MSAA alone leaves the wing
 * edges and the fin crawling.
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

/** Called from the main process. One sheet per aircraft, as data URLs. */
export async function render({ planeGltf, f35bBase64, frame, scale }) {
  const bytes = Uint8Array.from(atob(f35bBase64), (c) => c.charCodeAt(0))
  return {
    frames: FRAMES.map((f) => f.id),
    plane: await sheet(planeGltf, frame, scale),
    f35b: await sheet(bytes.buffer, frame, scale),
  }
}
