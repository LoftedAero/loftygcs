import { useEffect, useRef } from 'react'
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

export default function SimTray() {
  const phase = useSimStore((s) => s.phase)
  const status = useSimStore((s) => s.status)
  const open = useUiStore((s) => s.simTrayOpen)
  const setOpen = useUiStore((s) => s.setSimTrayOpen)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => subscribeSimEvents(), [])

  // Click-away and Escape, the two ways anyone expects to dismiss a tray.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen])

  const running = phase === 'running' || status?.running != null
  const busy = phase === 'installing' || phase === 'starting'
  const state = phase === 'error' ? 'bad' : running ? 'ok' : busy ? 'busy' : 'off'
  const summary =
    phase === 'error'
      ? 'Simulator failed'
      : running
        ? `${status?.running ?? 'Simulator'} running on port ${status?.port ?? 5760}`
        : phase === 'installing'
          ? 'Downloading the simulator…'
          : phase === 'starting'
            ? 'Starting the simulator…'
            : 'Simulator — not running'

  return (
    <div className="app-simtray" ref={wrap}>
      <button
        type="button"
        className={open ? 'app-simtray__btn is-open' : 'app-simtray__btn'}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={summary}
        onClick={() => setOpen(!open)}
      >
        <span className={`app-simtray__dot app-simtray__dot--${state}`} aria-hidden="true" />
        Simulator
      </button>
      {open && (
        <div className="app-simtray__panel" role="dialog" aria-label="Simulator">
          {simulatorAvailable() ? (
            <SimulatorControls onStarted={() => setOpen(false)} />
          ) : (
            <BrowserNote />
          )}
        </div>
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
      <h3 className="app-simtray__head">Simulator</h3>
      <p className="app-simtray__note">
        The desktop app downloads and runs ArduPilot SITL for you — real firmware, the full
        parameter set, real arming checks. A browser cannot start a process or open the raw TCP
        socket SITL listens on.
      </p>
      <p className="app-simtray__note">
        You can still reach a simulator someone else is running, if it is exposed through a
        WebSocket bridge such as mavlink-server: choose WebSocket in the connection menu. Otherwise
        Demo mode, in the same menu, needs nothing at all.
      </p>
    </>
  )
}
