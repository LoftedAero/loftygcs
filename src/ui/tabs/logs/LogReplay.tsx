import { useEffect, useRef, useState } from 'react'
import { LaHint } from '../../components/La'
import { flightPath, type FlightPath } from '../../../protocol/log-path'
import { useLogStore } from '../../../stores/log-store'

// The 3D replay: the flight path in space, on a globe you can orbit.
//
// CesiumJS, loaded lazily. It is a large library -- tens of megabytes of
// workers, shaders and widget assets -- and most sessions never open this
// tab, so nothing about it may reach the main bundle. That is the whole
// reason for the dynamic import below rather than a top-level one.
//
// Keyless on purpose. Cesium's defaults reach for Cesium ion (an account, a
// token, and requests attributable to it); this uses the same Esri imagery
// the Mission and Fly maps already use, so the replay contacts nothing the
// app was not contacting already. The cost is that the globe has no shaped
// terrain -- the path is genuinely three-dimensional, the ground under it
// is smooth. Terrain is what an ion token would buy, and it can be added as
// an opt-in later without changing anything here.
//
// The log itself never leaves the machine. Map tiles for the region do get
// requested, which is a different statement, and the screen says so.

/** Where the Cesium runtime finds its workers and assets. */
const CESIUM_BASE = './cesium/'

/** Same imagery as the 2D maps, keyless, attribution required. */
const IMAGERY_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

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

export default function LogReplay() {
  const log = useLogStore((s) => s.log)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<{ destroy: () => void; isDestroyed: () => boolean } | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [path, setPath] = useState<FlightPath | null>(null)

  useEffect(() => {
    if (!log) return
    setPath(flightPath(log))
  }, [log])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !path || path.samples.length === 0) return
    let cancelled = false
    setStatus('loading')

    void (async () => {
      try {
        // Without WebGL there is nothing to say but so, and Cesium's own
        // failure is an exception from deep inside its renderer.
        if (!hasWebGL()) throw new Error('this browser has no WebGL')
        // Cesium reads this off the window as it initializes, so it has to
        // be set before the module body runs -- not after the import.
        ;(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = CESIUM_BASE
        const Cesium = await import('cesium')
        await import('cesium/Build/Cesium/Widgets/widgets.css')
        if (cancelled) return

        const viewer = new Cesium.Viewer(el, {
          // Everything ion-backed is off: no token, no account, no request
          // to cesium.com. The imagery below is the app's own.
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
          baseLayer: new Cesium.ImageryLayer(
            new Cesium.UrlTemplateImageryProvider({
              url: IMAGERY_URL,
              // Esri serves Web Mercator. Cesium's template provider
              // defaults to a geographic scheme, so without this every tile
              // is requested at coordinates that do not exist and the globe
              // renders black -- with no failed request to show for it.
              tilingScheme: new Cesium.WebMercatorTilingScheme(),
              maximumLevel: 19,
              credit: new Cesium.Credit(
                'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
              ),
            }),
          ),
        })
        viewerRef.current = viewer as unknown as typeof viewerRef.current

        // Cesium stamps an ion logo into its credit container by default.
        // Nothing here uses ion, so that badge would be claiming a
        // relationship this app does not have. The imagery attribution
        // Esri's terms do require is rendered below the scene instead, the
        // way map-layers.ts carries it for the 2D maps.
        const credits = viewer.cesiumWidget.creditContainer as HTMLElement
        credits.style.display = 'none'

        // The track itself, at its real altitudes.
        const positions = path.samples.map((s) =>
          Cesium.Cartesian3.fromDegrees(s.lon, s.lat, s.alt),
        )
        viewer.entities.add({
          polyline: {
            positions,
            width: 3,
            material: Cesium.Color.fromCssColorString('#F7941D'),
            // Drawn through the terrain rather than clamped to it: the
            // altitude is the point, and a path that hugs the ground is
            // just the 2D map again.
            clampToGround: false,
          },
        })

        // Where it started, so the track has somewhere to be measured from.
        const first = path.samples[0]!
        viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(first.lon, first.lat, first.alt),
          point: {
            pixelSize: 10,
            color: Cesium.Color.fromCssColorString('#2FAE4E'),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
          },
        })

        // Put the camera on the flight, from a bounding sphere computed
        // here rather than by zoomTo. zoomTo waits on each entity's own
        // bounds to become available and quietly does nothing if they are
        // not -- which left the camera in its default position, staring at
        // empty space with the track somewhere behind it.
        const sphere = Cesium.BoundingSphere.fromPoints(positions)
        viewer.camera.flyToBoundingSphere(sphere, {
          duration: 0,
          // Looking down from the south-west at a shallow angle, far enough
          // out to see the whole track: straight down would make a climb
          // invisible, which is the one thing the 3D view exists to show.
          offset: new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(-45),
            Cesium.Math.toRadians(-35),
            Math.max(sphere.radius * 4, 400),
          ),
        })
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setStatus('failed')
      }
    })()

    return () => {
      cancelled = true
      const viewer = viewerRef.current
      viewerRef.current = null
      if (viewer && !viewer.isDestroyed()) viewer.destroy()
    }
  }, [path])

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
      {path && path.samples.length > 0 && (
        <p className="log-replay__note">
          {path.samples.length.toLocaleString()} positions from {path.source}
          {!path.hasAttitude && ' · no attitude in this log'} · imagery © Esri, Maxar, Earthstar
          Geographics · tiles are fetched for this area; the log itself stays on this machine
        </p>
      )}
    </div>
  )
}
