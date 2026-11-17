// Binds the receiver sequence (protocol/elrs/usb-passthrough.ts) to the live
// connection and to esptool. The connection is the app's own, so the vehicle
// appears connected on screen whenever MAVLink is up; it closes for esptool
// and reopens on the same port.

import {
  restoreReceiver,
  writeReceiver,
  type PassthroughLink,
  type PassthroughStep,
  type SavedState,
  type WriteOutcome,
} from '../protocol/elrs/usb-passthrough'
import type { ReceiverWiring } from '../protocol/lofted-boards'
import { connectionService } from './connection'
import { useConnectionStore } from '../stores/connection-store'
import { useParamStore } from '../stores/param-store'
import { useVehicleStore } from '../stores/vehicle-store'
import { writeEspImages } from './esp-flash'
import type { EspImage } from './elrs-firmware'

const MAV_CMD_DO_SET_RELAY = 181
const MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN = 246
const REBOOT_WAIT_MS = 60000

/** Resolve when `ok` holds, polling the stores; false on timeout. */
export function until(ok: () => boolean, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + ms
    const tick = () => {
      if (ok()) resolve(true)
      else if (Date.now() >= deadline) resolve(false)
      else setTimeout(tick, 100)
    }
    tick()
  })
}

const connected = () => useConnectionStore.getState().phase === 'connected'
const paramsReady = () => useParamStore.getState().loadState === 'ready'

/**
 * The values saved before a run, by board id, so a run interrupted by a
 * crash or a closed window can be put right on the next connection. Only
 * this browser profile holds them; the restore does not depend on them
 * (it falls back to the parameter's default).
 */
export function savedState(boardId: number): SavedState {
  const key = `loftgcs.receiver-restore.${boardId}`
  return {
    load() {
      try {
        const raw = localStorage.getItem(key)
        return raw ? (JSON.parse(raw) as Record<string, number>) : null
      } catch {
        return null
      }
    },
    save(values) {
      try {
        localStorage.setItem(key, JSON.stringify(values))
      } catch {
        // Private browsing or storage refused: the restore still works from defaults.
      }
    },
    clear() {
      try {
        localStorage.removeItem(key)
      } catch {
        // As above.
      }
    },
  }
}

/** The connection as the sequence needs it. `port` is what esptool will use. */
function liveLink(): PassthroughLink & { port: () => SerialPort | null } {
  let released: { port: SerialPort; baudRate: number } | null = null
  return {
    port: () => released?.port ?? null,
    armed: () => useVehicleStore.getState().armed,
    readParam: (name) => connectionService.readParam(name),
    knownParams: () =>
      new Map([...useParamStore.getState().entries].map(([name, e]) => [name, e.origValue])),
    // A parameter the store has not seen goes as REAL32, which ArduPilot
    // accepts for every parameter, as the specification sends.
    writeParam: (name, value) => connectionService.setParamNow(name, value),
    setRelay: (instance, high) =>
      connectionService
        .runCommand(MAV_CMD_DO_SET_RELAY, [instance, high ? 1 : 0, 0, 0, 0, 0, 0], 1000)
        .catch(() => -1),
    async reboot() {
      connectionService.expectReboot()
      await connectionService
        .runCommand(MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN, [1, 0, 0, 0, 0, 0, 0], 400)
        .catch(() => -1)
      if (!(await until(() => connected() && paramsReady(), REBOOT_WAIT_MS))) {
        throw new Error('The flight controller did not come back after the reboot.')
      }
    },
    async closeLink() {
      released = (await connectionService.releaseSerialPort()) ?? released
    },
    async openLink(timeoutMs) {
      if (!released) return false
      await connectionService.connect({
        kind: 'serial',
        baudRate: released.baudRate,
        port: released.port,
      })
      if (await until(connected, timeoutMs)) return true
      await connectionService.disconnect()
      return false
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  }
}

export interface ReceiverJob {
  boardId: number
  wiring: ReceiverWiring
  passthroughProtocol: number
  onStep?: (step: PassthroughStep) => void
}

/** Steps 1 to 9 with esptool writing `images`. */
export async function flashReceiver(
  job: ReceiverJob,
  images: EspImage[],
  onProgress?: (pct: number) => void,
): Promise<WriteOutcome> {
  if (!connected()) throw new Error('Connect to the flight controller first.')
  const link = liveLink()
  return writeReceiver(
    {
      link,
      wiring: job.wiring,
      passthroughProtocol: job.passthroughProtocol,
      state: savedState(job.boardId),
      ...(job.onStep ? { onStep: job.onStep } : {}),
    },
    async () => {
      const port = link.port()
      if (!port) throw new Error('The connection is not a USB serial port.')
      await writeEspImages(port, images, onProgress)
    },
  )
}

/** Step 9 alone, for a run that stopped before it. Needs a live connection. */
export async function restoreReceiverSettings(job: ReceiverJob): Promise<void> {
  if (!connected()) throw new Error('Connect to the flight controller first.')
  await restoreReceiver({
    link: liveLink(),
    wiring: job.wiring,
    passthroughProtocol: job.passthroughProtocol,
    state: savedState(job.boardId),
    ...(job.onStep ? { onStep: job.onStep } : {}),
  })
}
