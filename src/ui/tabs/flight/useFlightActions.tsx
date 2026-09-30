import { useState } from 'react'
import { useConnectionStore } from '../../../stores/connection-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useParamStore } from '../../../stores/param-store'
import { useHudNoteStore } from '../../../stores/hud-note-store'
import { MAV_RESULT } from '../../../protocol/commands'
import { modeNumberByName, modeTable, vehicleClass } from '../../../protocol/modes'
import { HUD_MESSAGE_SEVERITY } from './hud-draw'
import { LaButton, LaModal } from '../../components/La'
import {
  arm,
  disarm,
  setModeConfirmed,
  takeoff as takeoffCommand,
  takeoffStyle,
} from '../../../services/flight'

// The commands that fly the aircraft, shared by the desktop controls and
// compact mode's command strip so both report results the same way.

export const TAKEOFF_ALT_M = 20

/** How recent a vehicle warning has to be to count as a refusal's reason. */
const REASON_WINDOW_MS = 4000

export function useFlightActions() {
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const vehicleType = useVehicleStore((s) => s.vehicleType)
  const armed = useVehicleStore((s) => s.armed)
  const relAltM = useVehicleStore((s) => s.relAltM)
  const modeName = useVehicleStore((s) => s.modeName)
  const isCopter = vehicleClass(vehicleType) === 'copter'
  // How this airframe takes off, from the same function the command uses. A
  // quadplane climbs vertically like a copter; only a fixed wing takes off by
  // mode.
  const qEnable = useParamStore((s) => s.entries.get('Q_ENABLE')?.value)
  const takeoffVia = takeoffStyle(vehicleType, qEnable)
  const say = useHudNoteStore((s) => s.say)
  const clearNote = useHudNoteStore((s) => s.clear)
  const [forceArmOpen, setForceArmOpen] = useState(false)

  /**
   * Whether the vehicle has explained a refusal itself. MAV_RESULT only says
   * FAILED; the reason ("Arm: Need Position Estimate") arrives just after the
   * ack as a warning, which the HUD already shows.
   */
  const explained = () =>
    useVehicleStore
      .getState()
      .statusTexts.some(
        (t) => t.severity <= HUD_MESSAGE_SEVERITY && Date.now() - t.at < REASON_WINDOW_MS,
      )

  // Results go to the HUD beside the vehicle's own warnings. Success says
  // nothing (the vehicle state is the confirmation) but clears any earlier
  // refusal.
  const report = (what: string) => async (result: number) => {
    if (result === 0) return clearNote()
    // The vehicle usually explains itself just after the ack, not with it.
    await new Promise((r) => setTimeout(r, 400))
    if (!explained()) say(`${what}: ${MAV_RESULT[result] ?? result}`)
  }
  const fail = (what: string) => (err: unknown) =>
    say(`${what}: ${err instanceof Error ? err.message : 'no answer'}`)

  const setMode = (num: number, label = 'Mode') =>
    void setModeConfirmed(num).then(report(label)).catch(fail(label))

  const jump = (name: string) => {
    const num = modeNumberByName(vehicleType, name)
    if (num === undefined) {
      say(`${name} is not a mode on this vehicle`)
      return
    }
    void setModeConfirmed(num)
      .then(async (r) => {
        await report(name)(r)
        // Copter will not start an Auto takeoff from the ground until the
        // throttle stick is raised, which a GCS without a transmitter cannot
        // do; otherwise it sits armed in Auto until it auto-disarms.
        if (r === 0 && name === 'Auto' && isCopter && relAltM < 1) {
          say('Copter will not start an Auto takeoff from the ground')
        }
      })
      .catch(fail(name))
  }

  const armVehicle = () =>
    void arm()
      .then((result) => {
        if (result === 0) clearNote()
        else {
          // Refused: the vehicle's reason is on the HUD; offer force-arm
          // behind an explicit danger confirm.
          if (!explained()) say(`Arm: ${MAV_RESULT[result] ?? result}`)
          setForceArmOpen(true)
        }
      })
      .catch(fail('Arm'))

  const disarmVehicle = () => void disarm().then(report('Disarm')).catch(fail('Disarm'))

  // A copter's EKF refuses Guided for a few seconds after boot; the vehicle's
  // reason ("requires position") shows on the HUD.
  const takeoff = () =>
    void takeoffCommand(TAKEOFF_ALT_M).then(report('Takeoff')).catch(fail('Takeoff'))

  /** The force-arm confirmation that follows a refused arm. */
  const forceArmDialog = (
    <LaModal
      open={forceArmOpen}
      title="Force arm?"
      actions={
        <>
          <LaButton variant="ghost" onClick={() => setForceArmOpen(false)}>
            Cancel
          </LaButton>
          <LaButton
            variant="danger"
            onClick={() => {
              setForceArmOpen(false)
              void arm(true).then(report('Force arm')).catch(fail('Force arm'))
            }}
          >
            Force arm
          </LaButton>
        </>
      }
    >
      <p>A preflight check failed. Force arm skips it rather than fixing it.</p>
    </LaModal>
  )

  return {
    connected,
    armed,
    relAltM,
    modeName,
    vehicleType,
    modes: modeTable(vehicleType),
    isCopter,
    takeoffVia,
    report,
    fail,
    clearNote,
    setMode,
    jump,
    arm: armVehicle,
    disarm: disarmVehicle,
    takeoff,
    forceArmDialog,
  }
}
