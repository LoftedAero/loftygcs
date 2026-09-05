import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import quadUrl from '../../models/quad_x.gltf?url'
import planeUrl from '../../models/airplane.gltf?url'
import f35bUrl from '../../models/f35b.glb?url'
import type { VehicleClass } from '../../protocol/modes'
import type { KnownAirframe } from '../../protocol/airframe'

// A live 3D airframe, the way Betaflight's setup tab shows one. Models are
// Betaflight's own (see src/models/ATTRIBUTION.md).
//
// Everything here is imperative on purpose: attitude arrives at telemetry
// rate, and driving a WebGL scene through React state would spend the whole
// frame budget on reconciliation. React owns the canvas element; three.js
// owns everything inside it.

/**
 * Repaints on the stock models, by material name. The biplane ships in
 * fire-engine red; this is the neutral grey of the biplane in the Lofted
 * Aero mark instead.
 *
 * The other three move with it rather than staying as authored: the stock
 * "metal" is a mid grey that would vanish against a grey airframe, and the
 * pale wood propeller would too. Darkening the struts and gear and warming
 * the propeller keeps every part legible against the fuselage, which is the
 * whole reason the model is here.
 *
 * Only the biplane has these material names -- the quad's are all
 * "Material.00N" -- so this cannot bleed into the multirotor.
 */
const REPAINT: Record<string, number> = {
  body_paint: 0xb4b7bf, // airframe: light neutral grey
  metal: 0x5f636b, // struts, undercarriage legs: darker, reads against the body
  wood: 0x9c7b4e, // propeller: a real wood brown, not pale tan
}

export interface Attitude {
  /** Radians, ArduPilot sense: roll right positive, pitch up positive. */
  roll: number
  pitch: number
  yaw: number
}

export default function VehicleView({
  vehicle,
  airframe,
  attitude,
  className,
}: {
  vehicle: VehicleClass
  /** A specific aircraft, when the vehicle named one we have a model for. */
  airframe?: KnownAirframe | null
  /** A function so the scene can sample at frame rate without re-rendering. */
  attitude: () => Attitude
  className?: string
}) {
  const mountRef = useRef<HTMLDivElement>(null)
  const attitudeRef = useRef(attitude)
  attitudeRef.current = attitude

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)

    // The model is normalized to a unit bounding sphere and the camera is
    // pulled back to fit it, recomputed whenever the panel resizes. With a
    // fixed camera distance instead, a taller panel means more pixels per
    // world unit and the airframe grows until it is cropped by its own frame.
    const VIEW_DIR = new THREE.Vector3(0, 0.42, 1).normalize()
    const frameModel = () => {
      const vFov = (camera.fov * Math.PI) / 180
      const fitHeight = 1 / Math.tan(vFov / 2)
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect)
      const fitWidth = 1 / Math.tan(hFov / 2)
      // Whichever axis is tighter decides, plus a little air around it.
      const distance = Math.max(fitHeight, fitWidth) * 1.12
      camera.position.copy(VIEW_DIR.clone().multiplyScalar(distance))
      camera.lookAt(0, 0, 0)
    }

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      // No WebGL (locked-down browser, software rendering disabled): leave
      // the panel empty rather than throwing out of a render.
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    // Lighting chosen so the model reads as a solid object on a light
    // background without looking like a video game: one key light, one fill,
    // and enough ambient that nothing goes to black.
    scene.add(new THREE.AmbientLight(0xffffff, 2.2))
    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.set(4, 8, 6)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.9)
    fill.position.set(-6, 2, -4)
    scene.add(fill)

    // The model hangs off a pivot so attitude can be set on the pivot while
    // the model keeps whatever internal orientation its author gave it.
    const pivot = new THREE.Group()
    scene.add(pivot)

    let disposed = false
    new GLTFLoader().load(
      airframe === 'f35b' ? f35bUrl : vehicle === 'copter' ? quadUrl : planeUrl,
      (gltf) => {
        if (disposed) return
        const model = gltf.scene
        // Normalize: centre on the origin, then scale so the bounding sphere
        // has radius 1. Both models then frame identically however they were
        // authored, and the camera maths above needs no per-model constants.
        const box = new THREE.Box3().setFromObject(model)
        const sphere = box.getBoundingSphere(new THREE.Sphere())
        model.position.sub(sphere.center)
        model.scale.setScalar(1 / (sphere.radius || 1))

        model.traverse((obj) => {
          const mesh = obj as THREE.Mesh
          const materials = Array.isArray(mesh.material)
            ? mesh.material
            : mesh.material
              ? [mesh.material]
              : []
          for (const material of materials) {
            const standard = material as THREE.MeshStandardMaterial
            const repaint = REPAINT[standard.name]
            // GLTFLoader gives each load its own materials, so this cannot
            // leak into another instance of the view.
            if (repaint !== undefined && standard.color) standard.color.setHex(repaint)
          }
        })

        pivot.add(model)
      },
      undefined,
      () => {
        // A missing model is a blank panel, not a broken tab.
      },
    )

    const resize = () => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      if (w === 0 || h === 0) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      frameModel()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(mount)

    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const { roll, pitch, yaw } = attitudeRef.current()
      // ArduPilot body frame (x forward, y right, z down) into three.js
      // (x right, y up, z toward viewer): roll turns about the view axis,
      // pitch about the screen x axis, yaw about the vertical.
      pivot.rotation.set(pitch, -yaw, -roll, 'YXZ')
      renderer.render(scene, camera)
    }
    tick()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.dispose()
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const material = mesh.material
        if (Array.isArray(material)) material.forEach((m) => m.dispose())
        else if (material) (material as THREE.Material).dispose()
      })
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
    // airframe as well as vehicle: the scene is built once per model, and
    // a vehicle that announces itself as an F-35B after the first frame
    // would otherwise keep whatever was loaded before it said so.
  }, [vehicle, airframe])

  return <div ref={mountRef} className={className ?? 'vehicle-view'} />
}
