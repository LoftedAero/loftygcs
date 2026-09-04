import { useEffect, useRef, useState } from 'react'
import { LaButton, LaHint } from '../../components/La'
import { flightPath, type FlightPath } from '../../../protocol/log-path'
import { useLogStore } from '../../../stores/log-store'
import quadModelUrl from '../../../models/quad_x.gltf?url'

// The 3D replay: fly the log back, on a globe you can orbit.
//
// A vehicle moves along the track at a speed you choose, carrying the
// attitude the log recorded, and the plot marks the same instant --
// watching the aircraft and reading what its sensors said at that moment is
// the point of having both views in one tool rather than two.
//
// CesiumJS, loaded lazily. It is a large library and most sessions never
// open this tab, so nothing about it may reach the main bundle; that is the
// whole reason for the dynamic import below.
//
// Keyless on purpose. Cesium's defaults reach for Cesium ion -- an account,
// a token, and requests attributable to it. The base layer here is the
// Natural Earth imagery that ships inside the Cesium package, so the globe
// draws with no network at all, and the same Esri imagery the Mission and
// Fly maps already use is layered over it for detail. That ordering is also
// a diagnosis: the first version used a remote provider as the *only*
// layer, and when it silently produced nothing the result was a black void
// with no way to tell a broken provider from a broken globe.
//
// The log itself never leaves the machine. Map tiles for the region do get
// requested, which is a different statement, and the screen says so.

/** Where the Cesium runtime finds its workers and assets. */
const CESIUM_BASE = './cesium/'

/** Same imagery as the 2D maps, keyless. Detail over the offline base. */
const IMAGERY_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

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
  Cesium: typeof import('cesium')
  viewer: import('cesium').Viewer
  epoch: import('cesium').JulianDate
}

export default function LogReplay() {
  const log = useLogStore((s) => s.log)
  const setPlayhead = useLogStore((s) => s.setPlayhead)
  const containerRef = useRef<HTMLDivElement>(null)
  /** The live scene, off React state: it changes every frame. */
  const liveRef = useRef<Live | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [diagnostic, setDiagnostic] = useState('')
  const [path, setPath] = useState<FlightPath | null>(null)
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
        // Cesium reads this as it initializes, so it has to be set before
        // the module body runs -- not after the import resolves.
        ;(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = CESIUM_BASE
        const Cesium = await import('cesium')
        await import('cesium/Build/Cesium/Widgets/widgets.css')
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
            // to a geographic scheme, and the mismatch asks for tiles at
            // coordinates that do not exist -- silently, with no failed
            // request to show for it.
            tilingScheme: new Cesium.WebMercatorTilingScheme(),
            maximumLevel: 19,
            credit: new Cesium.Credit(
              'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
            ),
          }),
        )

        // Cesium stamps an ion logo into its credit container by default.
        // Nothing here uses ion, so that badge would claim a relationship
        // this app does not have; Esri's attribution, which its terms do
        // require, is rendered under the scene instead.
        ;(viewer.cesiumWidget.creditContainer as HTMLElement).style.display = 'none'

        const timeOf = (t: number) =>
          Cesium.JulianDate.addSeconds(epoch, t, new Cesium.JulianDate())

        const position = new Cesium.SampledPositionProperty()
        const orientation = new Cesium.TimeIntervalCollectionProperty()
        const track: import('cesium').Cartesian3[] = []
        for (let i = 0; i < path.samples.length; i++) {
          const s = path.samples[i]!
          const when = timeOf(s.time)
          const where = Cesium.Cartesian3.fromDegrees(s.lon, s.lat, s.alt)
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
                  Cesium.Math.toRadians(s.yaw),
                  Cesium.Math.toRadians(s.pitch),
                  Cesium.Math.toRadians(s.roll),
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
            // At its real altitude rather than clamped to the ground: the
            // height is the point, and a path that hugs the terrain is just
            // the 2D map again.
            clampToGround: false,
          },
        })
        viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(first.lon, first.lat, first.alt),
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
          // A point as well as the model: if the glTF fails to load there
          // is still something visibly flying, rather than an empty sky and
          // no clue which of the two went wrong.
          point: {
            pixelSize: 8,
            color: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.fromCssColorString('#2D2D2F'),
            outlineWidth: 2,
          },
          model: { uri: quadModelUrl, minimumPixelSize: 48, maximumScale: 200 },
        })

        const sphere = Cesium.BoundingSphere.fromPoints(track)
        viewer.camera.flyToBoundingSphere(sphere, {
          duration: 0,
          // From the side and above rather than straight down: overhead
          // makes a climb invisible, which is the one thing this view is
          // for.
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
        // Enough state to tell a broken provider from a broken globe
        // without a debugger: this is the one screen whose failure mode is
        // a plausible-looking empty sky.
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
    // Deliberately not depending on `speed`: it is applied to the clock by
    // the effect below, rather than by rebuilding the whole scene.
  }, [path, setPlayhead])

  useEffect(() => {
    const live = liveRef.current
    if (!live || status !== 'ready') return
    live.viewer.clock.multiplier = speed
    live.viewer.clock.shouldAnimate = playing
  }, [playing, speed, status])

  const scrub = (t: number) => {
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
              scrub(Number(e.target.value))
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
          {diagnostic && ` · ${diagnostic}`} · imagery © Esri, Maxar, Earthstar Geographics ·
          tiles fetched for this area; the log itself stays on this machine
        </p>
      )}
    </div>
  )
}
