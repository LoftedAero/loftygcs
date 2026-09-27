import { useEffect, useRef, useState } from 'react'
import { LaButton, LaHint } from '../../components/La'
import { flightPath, type FlightPath } from '../../../protocol/log-path'
import { useLogStore } from '../../../stores/log-store'
import { vehicleClassFromLog } from '../../../protocol/log-modes'
import { airframeFromLog } from '../../../protocol/airframe'
import quadModelUrl from '../../../models/quad_x.gltf?url'
import planeModelUrl from '../../../models/airplane.gltf?url'
import f35bModelUrl from '../../../models/f35b.glb?url'

// The 3D log replay on an orbitable globe. The vehicle follows the track
// with its recorded attitude, and the plot marks the same instant.
//
// CesiumJS is loaded lazily so it never reaches the main bundle.
//
// No Cesium ion (which needs an account and token): the base layer is the
// Natural Earth imagery bundled with Cesium, so the globe draws offline, with
// the same Esri imagery as the 2D maps layered over it. If Esri fails, the
// globe still renders.
//
// The log never leaves the machine; map tiles for the region are fetched.

/** Where the Cesium runtime finds its workers and assets. */
const CESIUM_BASE = './cesium/'

/** Same imagery as the 2D maps, keyless. Detail over the offline base. */
const IMAGERY_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

/**
 * How the glTF models sit relative to Cesium's heading/pitch/roll. At raw
 * heading zero they point west, and their pitch and roll run opposite to
 * ArduPilot's, so ArduPilot's yaw/pitch/roll maps to
 * HeadingPitchRoll(yaw + 90, -pitch, -roll).
 *
 * Determined empirically by rendering known attitudes (overhead for heading,
 * from behind for roll, side-on facing east for pitch). Re-check the same way
 * if a model is replaced.
 */
const MODEL_HEADING_OFFSET_DEG = 90
const MODEL_PITCH_SIGN = -1
const MODEL_ROLL_SIGN = -1

/** Playback speeds, in multiples of real time. */
const SPEEDS = [1, 2, 5, 10, 25]

type Status = 'idle' | 'loading' | 'ready' | 'failed'

/** Whether this browser can draw a globe at all. */
function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

/** What the replay holds on to between renders. */
interface Live {
  Cesium: CesiumModule
  viewer: import('cesium').Viewer
  epoch: import('cesium').JulianDate
}

type CesiumModule = typeof import('cesium')

/**
 * Loads the prebuilt CesiumJS bundle once, via a script tag rather than
 * `import('cesium')`. Bundled through Vite, Cesium's ESM source renders no
 * globe and reports no error: the globe's shaders are assembled at runtime
 * from pieces the tree-shaker drops.
 */
function loadCesium(): Promise<CesiumModule> {
  const existing = (window as unknown as { Cesium?: CesiumModule }).Cesium
  if (existing) return Promise.resolve(existing)
  if (!pending) {
    pending = new Promise<CesiumModule>((resolve, reject) => {
      // Cesium reads this during initialization, so set it before the script runs.
      ;(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = CESIUM_BASE

      const css = document.createElement('link')
      css.rel = 'stylesheet'
      css.href = `${CESIUM_BASE}Widgets/widgets.css`
      document.head.appendChild(css)

      const script = document.createElement('script')
      script.src = `${CESIUM_BASE}Cesium.js`
      script.onload = () => {
        const loaded = (window as unknown as { Cesium?: CesiumModule }).Cesium
        if (loaded) resolve(loaded)
        else reject(new Error('Cesium.js loaded but defined no Cesium global'))
      }
      script.onerror = () => reject(new Error(`could not load ${script.src}`))
      document.head.appendChild(script)
    })
  }
  return pending
}

let pending: Promise<CesiumModule> | null = null

export default function LogReplay() {
  const log = useLogStore((s) => s.log)
  const setPlayhead = useLogStore((s) => s.setPlayhead)
  const seekTo = useLogStore((s) => s.seekTo)
  const containerRef = useRef<HTMLDivElement>(null)
  /** The live scene, off React state: it changes every frame. */
  const liveRef = useRef<Live | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [diagnostic, setDiagnostic] = useState('')
  const [path, setPath] = useState<FlightPath | null>(null)
  // Which vehicle flew, from the log's firmware banner.
  const isPlane = log ? vehicleClassFromLog(log) === 'plane' : false
  // ArduPilot names the frame in its boot banner, so an airframe with its
  // own model is drawn as itself.
  const airframe = log ? airframeFromLog(log) : null
  const modelUrl = airframe === 'f35b' ? f35bModelUrl : isPlane ? planeModelUrl : quadModelUrl
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(5)
  const [at, setAt] = useState(0)

  useEffect(() => {
    if (log) setPath(flightPath(log))
  }, [log])

  const span =
    path && path.samples.length > 0
      ? { from: path.samples[0]!.time, to: path.samples[path.samples.length - 1]!.time }
      : null

  useEffect(() => {
    const el = containerRef.current
    if (!el || !path || path.samples.length === 0) return
    let cancelled = false
    let stopTicking: (() => void) | null = null
    setStatus('loading')

    void (async () => {
      try {
        if (!hasWebGL()) throw new Error('this browser has no WebGL')
        const Cesium = await loadCesium()
        if (cancelled) return

        const offline = await Cesium.TileMapServiceImageryProvider.fromUrl(
          Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII'),
        )
        if (cancelled) return

        const viewer = new Cesium.Viewer(el, {
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          infoBox: false,
          selectionIndicator: false,
          timeline: false,
          animation: false,
          fullscreenButton: false,
          baseLayer: new Cesium.ImageryLayer(offline),
        })
        const epoch = Cesium.JulianDate.fromIso8601('2000-01-01T00:00:00Z')
        liveRef.current = { Cesium, viewer, epoch }

        // Detail over the offline base, so a failure here degrades to a
        // coarse globe rather than to nothing.
        viewer.imageryLayers.addImageryProvider(
          new Cesium.UrlTemplateImageryProvider({
            url: IMAGERY_URL,
            // Esri serves Web Mercator; Cesium's template provider defaults
            // to a geographic scheme and would silently request wrong tiles.
            tilingScheme: new Cesium.WebMercatorTilingScheme(),
            maximumLevel: 19,
            credit: new Cesium.Credit(
              'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
            ),
          }),
        )

        // Hide Cesium's default ion logo, since ion is not used. Esri's
        // required attribution is rendered under the scene instead.
        ;(viewer.cesiumWidget.creditContainer as HTMLElement).style.display = 'none'

        const timeOf = (t: number) =>
          Cesium.JulianDate.addSeconds(epoch, t, new Cesium.JulianDate())

        const position = new Cesium.SampledPositionProperty()
        const orientation = new Cesium.TimeIntervalCollectionProperty()
        const track: InstanceType<CesiumModule['Cartesian3']>[] = []
        for (let i = 0; i < path.samples.length; i++) {
          const s = path.samples[i]!
          const when = timeOf(s.time)
          // altAboveHome, not AMSL: with no terrain the ground is the
          // ellipsoid at height zero, so an AMSL track would float above it
          // by the field's elevation.
          const where = Cesium.Cartesian3.fromDegrees(s.lon, s.lat, s.altAboveHome)
          position.addSample(when, where)
          track.push(where)
          orientation.intervals.addInterval(
            new Cesium.TimeInterval({
              start: when,
              stop: timeOf(path.samples[i + 1]?.time ?? s.time + 1),
              isStopIncluded: false,
              data: Cesium.Transforms.headingPitchRollQuaternion(
                where,
                new Cesium.HeadingPitchRoll(
                  Cesium.Math.toRadians(s.yaw + MODEL_HEADING_OFFSET_DEG),
                  Cesium.Math.toRadians(s.pitch * MODEL_PITCH_SIGN),
                  Cesium.Math.toRadians(s.roll * MODEL_ROLL_SIGN),
                ),
              ),
            }),
          )
        }

        const first = path.samples[0]!
        const lastSample = path.samples[path.samples.length - 1]!
        viewer.clock.startTime = timeOf(first.time)
        viewer.clock.stopTime = timeOf(lastSample.time)
        viewer.clock.currentTime = timeOf(first.time)
        viewer.clock.clockRange = Cesium.ClockRange.CLAMPED
        viewer.clock.multiplier = speed
        viewer.clock.shouldAnimate = false

        viewer.entities.add({
          polyline: {
            positions: track,
            width: 3,
            material: Cesium.Color.fromCssColorString('#F7941D'),
            // At its recorded height rather than clamped to the ground.
            clampToGround: false,
          },
        })
        viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(first.lon, first.lat, first.altAboveHome),
          point: {
            pixelSize: 9,
            color: Cesium.Color.fromCssColorString('#2FAE4E'),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
          },
        })
        viewer.entities.add({
          position,
          orientation,
          // At the distances a flight is framed from, a true-scale model is
          // a few pixels; minimumPixelSize keeps it readable.
          model: { uri: modelUrl, minimumPixelSize: 110, maximumScale: 200 },
        })

        const sphere = Cesium.BoundingSphere.fromPoints(track)
        viewer.camera.flyToBoundingSphere(sphere, {
          duration: 0,
          // Oblique rather than overhead, where climbs would be invisible.
          offset: new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(-45),
            Cesium.Math.toRadians(-30),
            Math.max(sphere.radius * 3, 300),
          ),
        })

        const onTick = () => {
          const t = Cesium.JulianDate.secondsDifference(viewer.clock.currentTime, epoch)
          setAt(t)
          setPlayhead(t)
        }
        viewer.clock.onTick.addEventListener(onTick)
        stopTicking = () => viewer.clock.onTick.removeEventListener(onTick)

        setAt(first.time)
        setStatus('ready')
        // Enough to tell a broken imagery provider from a broken globe.
        setDiagnostic(
          `${viewer.imageryLayers.length} layers · ${viewer.entities.values.length} entities`,
        )
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setStatus('failed')
      }
    })()

    return () => {
      cancelled = true
      stopTicking?.()
      const live = liveRef.current
      liveRef.current = null
      setPlayhead(null)
      if (live && !live.viewer.isDestroyed()) live.viewer.destroy()
    }
    // Not dependent on `speed`, which the effect below applies to the clock
    // without rebuilding the scene.
  }, [path, modelUrl, setPlayhead])

  useEffect(() => {
    const live = liveRef.current
    if (!live || status !== 'ready') return
    live.viewer.clock.multiplier = speed
    live.viewer.clock.shouldAnimate = playing
  }, [playing, speed, status])

  // A seek requested elsewhere (a click on the plot). A separate store field
  // from `playhead`, which this component writes every frame, to avoid a loop.
  useEffect(() => {
    if (seekTo === null || status !== 'ready') return
    setPlaying(false)
    seek(seekTo)
  }, [seekTo, status])

  const seek = (t: number) => {
    const live = liveRef.current
    if (!live) return
    live.viewer.clock.currentTime = live.Cesium.JulianDate.addSeconds(
      live.epoch,
      t,
      new live.Cesium.JulianDate(),
    )
    setAt(t)
    setPlayhead(t)
  }

  if (!log) return null

  return (
    <div className="log-replay">
      <div className="log-replay__scene" ref={containerRef} />

      {status !== 'ready' && (
        <div className="log-replay__overlay">
          {status === 'loading' && <p className="app-placeholder">Loading the globe…</p>}
          {status === 'failed' && <LaHint error>Could not start the 3D view: {error}</LaHint>}
          {path && path.samples.length === 0 && (
            <p className="app-placeholder">
              {path.problems.join(' ') || 'This log has no position to replay.'}
            </p>
          )}
        </div>
      )}

      {status === 'ready' && span && (
        <div className="log-replay__transport">
          <LaButton variant="primary" size="sm" onClick={() => setPlaying((p) => !p)}>
            {playing ? 'Pause' : 'Play'}
          </LaButton>
          <input
            className="log-replay__scrub"
            type="range"
            min={span.from}
            max={span.to}
            step={0.05}
            value={at}
            aria-label="Replay position"
            onChange={(e) => {
              setPlaying(false)
              seek(Number(e.target.value))
            }}
          />
          <span className="log-replay__clock">
            {(at - span.from).toFixed(1)} / {(span.to - span.from).toFixed(1)} s
          </span>
          <select
            className="log-replay__speed"
            value={speed}
            aria-label="Playback speed"
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </div>
      )}

      {path && path.samples.length > 0 && (
        <p className="log-replay__note">
          {path.samples.length.toLocaleString()} positions from {path.source}
          {!path.hasAttitude && ' · no attitude in this log'}
          {path.groundAlt !== null &&
            ` · heights above launch (${path.groundAlt.toFixed(0)} m AMSL)`}
          {/* CC-BY requires the credit wherever the model is shown. See
              src/models/ATTRIBUTION.md. */}
          {isPlane && airframe !== 'f35b' && (
            <>
              {' · biplane by '}
              <a
                href="https://sketchfab.com/3d-models/low-poly-biplane-755175daea384176813e7dc90b2245a5"
                target="_blank"
                rel="noreferrer noopener"
              >
                lord_syrup
              </a>
              {', CC-BY-4.0, recolored'}
            </>
          )}
          {diagnostic && ` · ${diagnostic}`} · imagery © Esri, Maxar, Earthstar Geographics · tiles
          fetched for this area; the log itself stays on this machine
        </p>
      )}
    </div>
  )
}
