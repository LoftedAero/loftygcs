import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { LaSelect, LaSwitch } from '../../components/La'
import { useConnectionStore } from '../../../stores/connection-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { MOUNT_MODES, hasGimbalManager } from '../../../protocol/gimbal'
import { mountMode, photo, point, record, zoomCamera } from '../../../services/camera'

// Camera control: two dials, one per axis. Pitch is a quarter dial seen from
// the side (Forward at the top, Down at the bottom); yaw is a half dial seen
// from above. Blue shows where the mount reports it is, the orange ring where
// it was last told to go. ArduPilot acks these commands even with no mount
// configured, so the reported position is the only proof it moved.
//
// Click or drag to aim; the command is sent on release so the vehicle does
// not queue one per pointer event. Angles snap to 5 degrees, and arrow keys
// step the focused dial by the same amount.
//
// Every command's ack is reported, since it is the only way to tell a
// successful photo from an unconfigured mount (MNT1_TYPE 0).

/** How long a result stays in its slot, as a card's does on Sensors. */
const STATUS_MS = 4000
/** Degrees a drag or an arrow key moves a dial by. */
const STEP = 5

const snap = (deg: number) => Math.round(deg / STEP) * STEP
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

type Status = { text: string; tone: 'busy' | 'ok' | 'bad' }

export default function CameraPanel() {
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const firmware = useVehicleStore((s) => s.firmware)
  const gimbal = useVehicleStore((s) => s.gimbal)
  const [mode, setMode] = useState(2)
  const [lockYaw, setLockYaw] = useState(false)
  const [recording, setRecording] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  // Where it was last told to go, which is what the orange rings draw.
  const [target, setTarget] = useState<{ pitch: number; yaw: number } | null>(null)

  // A result clears after a moment; the busy line stays until a result
  // replaces it.
  useEffect(() => {
    if (!status || status.tone === 'busy') return
    const t = setTimeout(() => setStatus(null), STATUS_MS)
    return () => clearTimeout(t)
  }, [status])

  const run = (what: string, fn: () => Promise<void>) => {
    setStatus({ text: `${what}…`, tone: 'busy' })
    void fn().then(
      () => setStatus({ text: `${what}: done`, tone: 'ok' }),
      (err: unknown) =>
        setStatus({
          text: `${what}: ${err instanceof Error ? err.message : String(err)}`,
          tone: 'bad',
        }),
    )
  }

  // The other axis keeps its last target, or failing that the mount's
  // reported angle, so aiming pitch does not swing the yaw back.
  const aim = (next: { pitch?: number; yaw?: number }) => {
    const pitch = next.pitch ?? target?.pitch ?? gimbal?.pitchDeg ?? 0
    const yaw = next.yaw ?? target?.yaw ?? gimbal?.yawDeg ?? 0
    setTarget({ pitch, yaw })
    run(`Point ${pitch}° / ${yaw}°`, () => point(pitch, yaw, lockYaw))
  }

  // Only the gimbal manager command can hold an earth heading; the older
  // command has no flag for it. Disabled rather than hidden so the layout is
  // the same on every firmware.
  const canLock = hasGimbalManager(firmware)

  return (
    // The pane is the size container and the inner grid sizes the dial
    // columns from it (a container cannot measure itself). The dials'
    // proportions come from the geometry below via CSS variables.
    <div
      className="camera-panel"
      style={
        {
          '--pitch-aspect': PITCH.width / PITCH.height,
          '--yaw-aspect': YAW.width / YAW.height,
          '--pitch-share': PITCH.width / (PITCH.width + YAW.width),
          '--yaw-share': YAW.width / (PITCH.width + YAW.width),
        } as CSSProperties
      }
    >
      <div className="camera-panel__grid">
        <section className="camera-panel__dial">
          <h4 className="camera-panel__head">Pitch</h4>
          <PitchDial
            live={gimbal?.pitchDeg ?? null}
            target={target?.pitch ?? null}
            disabled={!connected}
            onAim={(pitch) => aim({ pitch })}
          />
        </section>

        <section className="camera-panel__dial camera-panel__dial--yaw">
          <h4 className="camera-panel__head">Yaw</h4>
          <YawDial
            live={gimbal?.yawDeg ?? null}
            target={target?.yaw ?? null}
            disabled={!connected}
            onAim={(yaw) => aim({ yaw })}
          />
          {/* Under the yaw dial, since it is about how yaw is held. */}
          <LaSwitch
            label="Lock yaw"
            checked={lockYaw}
            disabled={!connected || !canLock}
            title={canLock ? undefined : 'Needs ArduPilot 4.2 or later'}
            onChange={(e) => setLockYaw(e.target.checked)}
          />
        </section>

        <section className="camera-panel__side">
          <h4 className="camera-panel__head">Mount</h4>
          <LaSelect
            aria-label="Mount mode"
            value={String(mode)}
            disabled={!connected}
            onChange={(e) => {
              const next = Number(e.target.value)
              setMode(next)
              run(MOUNT_MODES.find((m) => m.value === next)?.label ?? 'Mode', () => mountMode(next))
            }}
          >
            {MOUNT_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </LaSelect>

          <h4 className="camera-panel__head">Camera</h4>
          <div className="camera-panel__shoot">
            <button
              type="button"
              className="cam-btn"
              disabled={!connected}
              onClick={() => run('Photo', photo)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10" className="cam-btn__ring" />
                <circle cx="12" cy="12" r="6.5" className="cam-btn__shutter" />
              </svg>
              Photo
            </button>
            <button
              type="button"
              className={`cam-btn${recording ? ' is-recording' : ''}`}
              disabled={!connected}
              aria-label={recording ? 'Stop recording' : 'Record'}
              onClick={() => {
                const start = !recording
                setRecording(start)
                run(start ? 'Record' : 'Stop recording', () => record(start))
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10" className="cam-btn__ring" />
                {recording ? (
                  <rect x="8" y="8" width="8" height="8" rx="1.5" className="cam-btn__rec" />
                ) : (
                  <circle cx="12" cy="12" r="6.5" className="cam-btn__rec" />
                )}
              </svg>
              {/* Short label for a narrow button; the accessible name is in
                full. */}
              {recording ? 'Stop' : 'Record'}
            </button>
            {/* Continuous zoom (camera protocol type 1): press to start,
              release to stop. */}
            <div className="camera-panel__zoom" role="group" aria-label="Zoom">
              <button
                type="button"
                className="cam-zoom"
                aria-label="Zoom in"
                title="Zoom in"
                disabled={!connected}
                onPointerDown={() => run('Zoom in', () => zoomCamera(1))}
                onPointerUp={() => void zoomCamera(0)}
                onPointerLeave={() => void zoomCamera(0)}
              >
                +
              </button>
              <button
                type="button"
                className="cam-zoom"
                aria-label="Zoom out"
                title="Zoom out"
                disabled={!connected}
                onPointerDown={() => run('Zoom out', () => zoomCamera(-1))}
                onPointerUp={() => void zoomCamera(0)}
                onPointerLeave={() => void zoomCamera(0)}
              >
                −
              </button>
            </div>
          </div>
          {/* Always rendered, so a result appearing does not shift the layout. */}
          <p
            className={`camera-panel__status${status ? ` camera-panel__status--${status.tone}` : ''}`}
            role="status"
            title={status?.text}
          >
            {status?.text ?? ''}
          </p>
        </section>
      </div>
    </div>
  )
}

/** Whole degrees with an explicit sign, never "-0". */
function formatAngle(v: number | null): string {
  if (v === null) return '—'
  const r = Math.round(v) || 0
  return `${r > 0 ? '+' : ''}${r}°`
}

/** A point on a circle, angles in degrees clockwise from +x as the screen draws them. */
function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0)
  const [x1, y1] = polar(cx, cy, r, a1)
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0
  return `M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1}`
}

interface DialGeometry {
  label: string
  width: number
  height: number
  cx: number
  cy: number
  r: number
  /** The arc, in screen degrees, drawn from a0 clockwise to a1. */
  a0: number
  a1: number
  ticks: number[]
  /** Axis value to screen degrees, and back. */
  toAngle: (v: number) => number
  fromAngle: (deg: number) => number
  min: number
  max: number
  valueAt: [number, number, 'start' | 'middle' | 'end']
}

interface DialProps {
  live: number | null
  target: number | null
  disabled: boolean
  onAim: (v: number) => void
}

/**
 * A dial as one interactive SVG: pointer to aim, arrows to step, the command
 * sent on release. The drag is tracked on the window rather than with pointer
 * capture, because the pane re-renders at telemetry rate and re-binding a
 * captured pointer every render can wedge input.
 */
function Dial({ g, live, target, disabled, onAim }: { g: DialGeometry } & DialProps) {
  const svg = useRef<SVGSVGElement | null>(null)
  // The dragged value; the ring follows it and it is sent on release.
  const [dragging, setDragging] = useState<number | null>(null)
  const latest = useRef<number | null>(null)
  const aimRef = useRef(onAim)
  aimRef.current = onAim

  const valueAt = (clientX: number, clientY: number): number | null => {
    const box = svg.current?.getBoundingClientRect()
    if (!box || box.width === 0) return null
    const x = ((clientX - box.left) / box.width) * g.width
    const y = ((clientY - box.top) / box.height) * g.height
    let deg = (Math.atan2(y - g.cy, x - g.cx) * 180) / Math.PI
    // atan2 answers in (-180, 180]; the yaw arc runs 180..360.
    if (deg < g.a0 - 90) deg += 360
    return clamp(snap(g.fromAngle(deg)), g.min, g.max)
  }

  const active = dragging !== null
  useEffect(() => {
    if (!active) return
    const move = (e: globalThis.PointerEvent) => {
      const v = valueAt(e.clientX, e.clientY)
      if (v !== null) {
        latest.current = v
        setDragging(v)
      }
    }
    const up = () => {
      const v = latest.current
      setDragging(null)
      latest.current = null
      if (v !== null) aimRef.current(v)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    // Keyed on the drag starting and ending only: valueAt reads the SVG's
    // box and the fixed geometry, and the aim goes through a ref.
  }, [active])

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (disabled) return
    const up = e.key === 'ArrowUp' || e.key === 'ArrowRight'
    const down = e.key === 'ArrowDown' || e.key === 'ArrowLeft'
    if (!up && !down) return
    e.preventDefault()
    const from = target ?? live ?? 0
    onAim(clamp(snap(from + (up ? STEP : -STEP)), g.min, g.max))
  }

  const ring = dragging ?? target
  const zero = g.toAngle(clamp(0, g.min, g.max))
  const liveAngle = live === null ? null : g.toAngle(clamp(live, g.min, g.max))

  return (
    <svg
      ref={svg}
      className={`cam-dial${disabled ? ' is-disabled' : ''}`}
      viewBox={`0 0 ${g.width} ${g.height}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={g.label}
      aria-valuemin={g.min}
      aria-valuemax={g.max}
      aria-valuenow={Math.round(target ?? live ?? 0)}
      aria-disabled={disabled}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        if (disabled) return
        const v = valueAt(e.clientX, e.clientY)
        if (v === null) return
        latest.current = v
        setDragging(v)
      }}
    >
      {/* A wide invisible stroke to enlarge the hit target. */}
      <path d={arcPath(g.cx, g.cy, g.r, g.a0, g.a1)} className="cam-dial__hit" />
      <path d={arcPath(g.cx, g.cy, g.r, g.a0, g.a1)} className="cam-dial__track" />
      {g.ticks.map((v) => {
        const [x0, y0] = polar(g.cx, g.cy, g.r + 8, g.toAngle(v))
        const [x1, y1] = polar(g.cx, g.cy, g.r + 14, g.toAngle(v))
        return <line key={v} x1={x0} y1={y0} x2={x1} y2={y1} className="cam-dial__tick" />
      })}
      {liveAngle !== null && (
        <>
          {liveAngle !== zero && (
            <path
              d={arcPath(g.cx, g.cy, g.r, Math.min(zero, liveAngle), Math.max(zero, liveAngle))}
              className="cam-dial__live"
            />
          )}
          <circle
            cx={polar(g.cx, g.cy, g.r, liveAngle)[0]}
            cy={polar(g.cx, g.cy, g.r, liveAngle)[1]}
            r={7}
            className="cam-dial__pip"
          />
        </>
      )}
      {ring !== null && (
        <circle
          cx={polar(g.cx, g.cy, g.r, g.toAngle(ring))[0]}
          cy={polar(g.cx, g.cy, g.r, g.toAngle(ring))[1]}
          r={8}
          className="cam-dial__target"
        />
      )}
      {/* The reported angle; the orange ring shows the target. */}
      <text x={g.valueAt[0]} y={g.valueAt[1]} textAnchor={g.valueAt[2]} className="cam-dial__value">
        {formatAngle(live)}
      </text>
    </svg>
  )
}

/** Pitch, seen from the side: 0 is Forward at the top end, -90 Down at the bottom. */
const PITCH: DialGeometry = {
  label: 'Camera pitch',
  width: 150,
  height: 138,
  cx: 16,
  cy: 16,
  r: 108,
  a0: 0,
  a1: 90,
  ticks: [0, -45, -90],
  toAngle: (p) => -p,
  fromAngle: (deg) => -deg,
  min: -90,
  max: 0,
  valueAt: [30, 62, 'start'],
}

/** Yaw, seen from above: 0 is straight ahead at the top, ±90 to either side. */
const YAW: DialGeometry = {
  label: 'Camera yaw',
  width: 224,
  // Kept low so the yaw column with Lock yaw under it fits without scrolling.
  height: 110,
  cx: 112,
  cy: 102,
  r: 88,
  a0: 180,
  a1: 360,
  ticks: [-90, -45, 0, 45, 90],
  toAngle: (y) => 270 + y,
  fromAngle: (deg) => deg - 270,
  min: -90,
  max: 90,
  valueAt: [112, 82, 'middle'],
}

function PitchDial(props: DialProps) {
  return <Dial g={PITCH} {...props} />
}

function YawDial(props: DialProps) {
  return <Dial g={YAW} {...props} />
}
