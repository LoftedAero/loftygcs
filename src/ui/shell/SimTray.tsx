import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import SimulatorControls from './SimulatorControls'
import { useSimStore } from '../../stores/sim-store'
import { simulatorAvailable, subscribeSimEvents } from '../../services/simulator'
import { useUiStore } from '../../stores/ui-store'

// The simulator, in the app bar rather than as a fourth mode.
//
// It was a whole screen holding one card, which put a simulator on the same
// footing as flying and mission planning -- and it is not one of those, it
// is a thing you switch on before doing one of them. As a tray it stays
// reachable from wherever the work is, which is the point: you start SITL
// from the Mission screen and go straight back to the plan you were drawing.
//
// The dot on the button is why this works at all. A simulator running in the
// background is easy to forget, and the cost of forgetting is a mystery TCP
// connection or a second SITL that will not bind. The dot is on the bar in
// every mode, so "is one running" never needs a trip anywhere to answer.
//
// The panel is a portal to the body, placed from the button's own rect. It
// hung inside the app bar, which sounds right and is not: `.la-appbar` is a
// grid item with a z-index, which makes it a *stacking context* at level 3,
// and a stacking context caps everything inside it -- so the panel could ask
// for any z-index it liked and still lose to Leaflet's control corners at
// 1000, which are in the root context because nothing between them and it
// creates one. The panel opened behind the map, and raising its own z-index
// could not fix that. Out here it is in the root context too, at 1500: above
// the map, below the modals at 2000.

export default function SimTray() {
  const phase = useSimStore((s) => s.phase)
  const status = useSimStore((s) => s.status)
  const open = useUiStore((s) => s.simTrayOpen)
  const setOpen = useUiStore((s) => s.setSimTrayOpen)
  const wrap = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // Viewport coordinates, since the panel no longer hangs from the tray.
  const [at, setAt] = useState<{ top: number; right: number } | null>(null)

  useEffect(() => subscribeSimEvents(), [])

  // Under the button and aligned to its right edge -- the same place it sat
  // when it was a child of the tray. Re-measured on resize, because a fixed
  // element placed once does not follow the bar when the window changes.
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

  // Click-away and Escape, the two ways anyone expects to dismiss a tray.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      // The panel is no longer inside the wrapper, so it has to be asked
      // separately -- without this, a click on any control in it closes it.
      if (!wrap.current?.contains(t) && !panel.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // Capture, not bubble: Leaflet's drag handler calls stopPropagation on
    // mousedown, so a click on the map never reached a bubble-phase listener
    // and the tray would not dismiss over the one surface it most often
    // covers. Capture runs before any of that.
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

/**
 * What a browser tab can and cannot do here.
 *
 * Kept rather than dropped with the old screen: someone who has used the
 * desktop build looks for the simulator first, and "there is no button"
 * reads as a bug where "a browser cannot start a process" reads as a
 * reason -- and points at the two things that do work from here.
 */
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
