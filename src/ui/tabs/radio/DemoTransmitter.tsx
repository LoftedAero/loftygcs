import { useEffect, useRef, useState } from 'react'
import { LaButton } from '../../components/La'
import { demoSticks } from '../../../transport/virtual-fc'

// Draggable sticks, shown only on the demo vehicle, so radio calibration can
// be tried without hardware. The pads do not spring back, because the wizard
// asks you to hold a stick at its limit while pressing a button.

interface Pad {
  side: 'left' | 'right'
  label: string
  xAxis: 'yaw' | 'roll'
  yAxis: 'throttle' | 'pitch'
}

const PADS: Pad[] = [
  { side: 'left', label: 'Throttle / Yaw', xAxis: 'yaw', yAxis: 'throttle' },
  { side: 'right', label: 'Pitch / Roll', xAxis: 'roll', yAxis: 'pitch' },
]

export default function DemoTransmitter() {
  // The transport holds the real values; this only draws the knobs.
  const [, force] = useState(0)
  const [drag, setDrag] = useState<Pad | null>(null)
  const padRef = useRef<HTMLDivElement | null>(null)

  const set = (pad: Pad, x: number, y: number) => {
    demoSticks.active = true
    demoSticks[pad.xAxis] = Math.max(-1, Math.min(1, x))
    demoSticks[pad.yAxis] = Math.max(-1, Math.min(1, y))
    force((n) => n + 1)
  }

  const setFromPoint = (pad: Pad, el: HTMLElement, clientX: number, clientY: number) => {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return
    set(pad, ((clientX - r.left) / r.width) * 2 - 1, 1 - ((clientY - r.top) / r.height) * 2)
  }

  // Tracked on the window rather than with setPointerCapture: the panel
  // re-renders at telemetry rate, and re-binding a captured pointer on every
  // render wedges input.
  useEffect(() => {
    if (!drag) return
    const el = padRef.current
    if (!el) return
    const move = (e: PointerEvent) => setFromPoint(drag, el, e.clientX, e.clientY)
    const stop = () => setDrag(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [drag])

  const center = () => {
    demoSticks.active = true
    demoSticks.roll = 0
    demoSticks.pitch = 0
    demoSticks.yaw = 0
    demoSticks.throttle = -1
    force((n) => n + 1)
  }

  return (
    <div className="demo-tx">
      <p className="demo-tx__note">Demo vehicle</p>
      <div className="demo-tx__pads">
        {PADS.map((pad) => {
          const x = demoSticks[pad.xAxis]
          const y = demoSticks[pad.yAxis]
          return (
            <div key={pad.side} className="demo-tx__pad-wrap">
              <div
                className="demo-tx__pad"
                role="application"
                aria-label={`${pad.label} stick`}
                onPointerDown={(e) => {
                  padRef.current = e.currentTarget
                  setDrag(pad)
                  setFromPoint(pad, e.currentTarget, e.clientX, e.clientY)
                }}
              >
                <span className="demo-tx__cross demo-tx__cross--h" />
                <span className="demo-tx__cross demo-tx__cross--v" />
                <span
                  className="demo-tx__knob"
                  style={{ left: `${((x + 1) / 2) * 100}%`, top: `${((1 - y) / 2) * 100}%` }}
                />
              </div>
              <span className="demo-tx__label">{pad.label}</span>
            </div>
          )
        })}
      </div>
      <LaButton variant="ghost" size="sm" onClick={center}>
        Center sticks
      </LaButton>
    </div>
  )
}
