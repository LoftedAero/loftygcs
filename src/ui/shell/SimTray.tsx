import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import SimulatorControls from './SimulatorControls'
import { useSimStore } from '../../stores/sim-store'
import { simulatorAvailable, subscribeSimEvents } from '../../services/simulator'
import { useUiStore } from '../../stores/ui-store'

// The simulator tray in the app bar, reachable from any mode. The status dot
// shows whether a SITL is running, since a forgotten one leaves a stray TCP
// connection or blocks a second SITL from binding.
//
// The panel is portaled to the body and positioned from the button's rect.
// `.la-appbar` is a grid item with a z-index, so it forms a stacking context
// that caps its children below Leaflet's controls (z-index 1000, root
// context). In the root context the panel sits at 1500: above the map, below
// the modals at 2000.

export default function SimTray() {
  const phase = useSimStore((s) => s.phase)
  const status = useSimStore((s) => s.status)
  const open = useUiStore((s) => s.simTrayOpen)
  const setOpen = useUiStore((s) => s.setSimTrayOpen)
  const wrap = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // Viewport coordinates, since the panel is portaled.
  const [at, setAt] = useState<{ top: number; right: number } | null>(null)

  useEffect(() => subscribeSimEvents(), [])

  // Under the button, aligned to its right edge; re-measured on resize.
  useEffect(() => {
    if (!open) return
    const place = () => {
      const r = btn.current?.getBoundingClientRect()
      if (r) setAt({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  // Dismiss on click-away and Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      // The portaled panel is outside the wrapper, so check it separately.
      if (!wrap.current?.contains(t) && !panel.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // Capture phase: Leaflet's drag handler stops mousedown propagation, so a
    // bubble-phase listener never hears clicks on the map.
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen])

  const running = phase === 'running' || status?.running != null
  const busy = phase === 'installing' || phase === 'starting'
  const state = phase === 'error' ? 'bad' : running ? 'ok' : busy ? 'busy' : 'off'
  const summary =
    phase === 'error'
      ? 'SITL failed'
      : running
        ? `${status?.running ?? 'SITL'} running on port ${status?.port ?? 5760}`
        : phase === 'installing'
          ? 'Downloading SITL…'
          : phase === 'starting'
            ? 'Starting SITL…'
            : 'SITL — not running'

  return (
    <div className="app-simtray" ref={wrap}>
      <button
        ref={btn}
        type="button"
        className={open ? 'app-simtray__btn is-open' : 'app-simtray__btn'}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={summary}
        onClick={() => setOpen(!open)}
      >
        <span className={`app-simtray__dot app-simtray__dot--${state}`} aria-hidden="true" />
        SITL
      </button>
      {open &&
        at &&
        createPortal(
          <div
            ref={panel}
            className="app-simtray__panel"
            role="dialog"
            aria-label="SITL"
            style={{ top: at.top, right: at.right }}
          >
            {simulatorAvailable() ? (
              <SimulatorControls onStarted={() => setOpen(false)} />
            ) : (
              <BrowserNote />
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}

/** Explains why the browser build cannot run SITL, and what works instead. */
function BrowserNote() {
  return (
    <>
      <h3 className="app-simtray__head">SITL</h3>
      <p className="app-simtray__note">
        The desktop app downloads and runs ArduPilot&rsquo;s software-in-the-loop simulator for you
        — real firmware, the full parameter set, real arming checks. A browser cannot start a
        process or open the raw TCP socket SITL listens on.
      </p>
      <p className="app-simtray__note">
        You can still reach a simulator someone else is running, if it is exposed through a
        WebSocket bridge such as mavlink-server: choose WebSocket in the connection menu. Otherwise
        Demo mode, in the same menu, needs nothing at all.
      </p>
    </>
  )
}
