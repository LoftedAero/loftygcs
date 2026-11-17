import { describe, expect, it } from 'vitest'
import type { ReceiverWiring } from '../lofted-boards'
import {
  interruptedRun,
  restoreReceiver,
  VehicleArmedError,
  writeReceiver,
  type PassthroughLink,
  type SavedState,
} from './usb-passthrough'

const wiring: ReceiverWiring = {
  target: 'newbeedrone.rx_2400.c324d',
  serial: 2,
  bootPin: 71,
  enPin: 70,
  baud: 420000,
}

/**
 * A strict model of the flight controller: unknown parameters are refused,
 * relays only move while configured on a pin, passthrough starts only with
 * SERIAL_PASS2, and `stock` reproduces ArduPilot's bug where, after the
 * passthrough times out, heartbeats return but nothing sent is read.
 */
class FakeFc implements PassthroughLink {
  params = new Map<string, number>([
    ['SERIAL2_PROTOCOL', 23],
    ['SERIAL_PASSTIMO', 15],
    ['SERIAL_PASS1', 0],
    ['SERIAL_PASS2', -1],
    ['RELAY1_FUNCTION', 0],
    ['RELAY1_PIN', -1],
    ['RELAY1_DEFAULT', 0],
    ['RELAY2_FUNCTION', 0],
    ['RELAY2_PIN', -1],
    ['RELAY2_DEFAULT', 0],
    ['RELAY3_FUNCTION', 0],
    ['RELAY3_PIN', -1],
  ])
  /** Pin levels as the ESP32 sees them; released (high) at boot. */
  pins = new Map<number, boolean>([
    [70, true],
    [71, true],
  ])
  log: string[] = []
  isArmed = false
  linkOpen = true
  passthrough = false
  deaf = false
  reboots = 0
  espInLoader = false

  constructor(private stock = false) {}

  private needLink() {
    if (!this.linkOpen) throw new Error('link closed')
    if (this.passthrough) throw new Error('MAVLink sent during passthrough')
  }

  armed() {
    return this.isArmed
  }
  knownParams() {
    return this.params
  }
  async readParam(name: string) {
    this.needLink()
    if (this.deaf) throw new Error(`${name}: no reply from the vehicle`)
    const v = this.params.get(name)
    if (v === undefined) throw new Error(`${name}: no reply from the vehicle`)
    return v
  }
  async writeParam(name: string, value: number) {
    this.needLink()
    if (this.deaf) throw new Error(`${name}: no reply from the vehicle`)
    if (!this.params.has(name)) throw new Error(`${name}: no reply from the vehicle`)
    this.params.set(name, value)
    this.log.push(`set ${name}=${value}`)
    if (name === 'SERIAL_PASS2' && value === 2) this.passthrough = true
    return value
  }
  async setRelay(instance: number, high: boolean) {
    this.needLink()
    if (this.deaf) return -1
    const n = instance + 1
    // As booted: a relay acts only with FUNCTION 1 and a pin.
    if (this.booted.get(`RELAY${n}_FUNCTION`) !== 1) return 4
    const pin = this.booted.get(`RELAY${n}_PIN`)!
    this.pins.set(pin, high)
    this.log.push(`relay ${n} ${high ? 'high' : 'low'}`)
    // EN rising with BOOT low enters the ROM loader; with BOOT high, the firmware.
    if (pin === 70 && high) this.espInLoader = this.pins.get(71) === false
    return 0
  }
  /** Parameter values the running firmware was started with. */
  booted = new Map(this.params)
  async reboot() {
    this.needLink()
    this.reboots++
    this.log.push('reboot')
    this.boot()
  }
  private boot() {
    this.booted = new Map(this.params)
    this.deaf = false
    this.passthrough = false
    // RELAYn_DEFAULT decides the pin at boot; 0 would hold the ESP32 in reset.
    for (const n of [1, 2]) {
      if (this.booted.get(`RELAY${n}_FUNCTION`) === 1) {
        this.pins.set(this.booted.get(`RELAY${n}_PIN`)!, this.booted.get(`RELAY${n}_DEFAULT`) === 1)
      }
    }
  }
  async closeLink() {
    this.linkOpen = false
    this.log.push('close')
  }
  async openLink() {
    this.log.push('open')
    if (this.passthrough) {
      // Passthrough has timed out by the time the sequence reopens.
      this.passthrough = false
      this.params.set('SERIAL_PASS2', -1)
      if (this.stock) this.deaf = true
    }
    this.linkOpen = true
    return true
  }
  async sleep(ms: number) {
    this.log.push(`sleep ${ms}`)
  }
  /** Power-cycle by USB: everything restarts, the ESP32 included. */
  replug() {
    this.boot()
    this.linkOpen = true
    this.espInLoader = false
  }
}

class MemoryState implements SavedState {
  value: Record<string, number> | null = null
  load() {
    return this.value
  }
  save(v: Record<string, number>) {
    this.value = { ...v }
  }
  clear() {
    this.value = null
  }
}

const opts = (fc: FakeFc, state = new MemoryState()) => ({
  link: fc,
  wiring,
  passthroughProtocol: 28,
  state,
})

const finalState = (fc: FakeFc) => ({
  SERIAL2_PROTOCOL: fc.params.get('SERIAL2_PROTOCOL'),
  RELAY1_FUNCTION: fc.params.get('RELAY1_FUNCTION'),
  RELAY1_PIN: fc.params.get('RELAY1_PIN'),
  RELAY2_FUNCTION: fc.params.get('RELAY2_FUNCTION'),
  RELAY2_PIN: fc.params.get('RELAY2_PIN'),
  SERIAL_PASSTIMO: fc.params.get('SERIAL_PASSTIMO'),
})
const RESTORED = {
  SERIAL2_PROTOCOL: 23,
  RELAY1_FUNCTION: 0,
  RELAY1_PIN: -1,
  RELAY2_FUNCTION: 0,
  RELAY2_PIN: -1,
  SERIAL_PASSTIMO: 15,
}

describe('writeReceiver', () => {
  it('runs the whole sequence on fixed firmware and leaves the relays cleared', async () => {
    const fc = new FakeFc()
    const state = new MemoryState()
    let loaderSeen = false
    const outcome = await writeReceiver(opts(fc, state), async () => {
      expect(fc.linkOpen).toBe(false)
      expect(fc.passthrough).toBe(true)
      loaderSeen = fc.espInLoader
    })
    expect(outcome).toEqual({ kind: 'done', esptoolError: null })
    expect(loaderSeen).toBe(true)
    expect(finalState(fc)).toEqual(RESTORED)
    expect(state.value).toBeNull()
    // One reboot for the flashing setup, one for the restore.
    expect(fc.reboots).toBe(2)
    // The receiver was started on its new firmware: BOOT high, then EN pulsed.
    expect(fc.espInLoader).toBe(false)
    expect(fc.log).toContain('set RELAY2_DEFAULT=1')
    // SERIAL_PASS2 is the last thing sent before the link closes.
    const close = fc.log.indexOf('close')
    expect(fc.log[close - 1]).toBe('set SERIAL_PASS2=2')
  })

  it('reports a replug on stock firmware and keeps what the restore needs', async () => {
    const fc = new FakeFc(true)
    const state = new MemoryState()
    const outcome = await writeReceiver(opts(fc, state), async () => {})
    expect(outcome).toEqual({ kind: 'replug', esptoolError: null })
    expect(state.value?.SERIAL_PASSTIMO).toBe(15)
    expect(fc.params.get('RELAY2_PIN')).toBe(70)

    fc.replug()
    await restoreReceiver(opts(fc, state))
    expect(finalState(fc)).toEqual(RESTORED)
    expect(state.value).toBeNull()
  })

  it('refuses an armed vehicle before changing anything', async () => {
    const fc = new FakeFc()
    fc.isArmed = true
    await expect(writeReceiver(opts(fc), async () => {})).rejects.toBeInstanceOf(VehicleArmedError)
    expect(fc.log.filter((l) => l.startsWith('set'))).toEqual([])
  })

  it('restores the settings when esptool fails, and says why', async () => {
    const fc = new FakeFc()
    const outcome = await writeReceiver(opts(fc), async () => {
      throw new Error('Failed to connect to ESP32-C3')
    })
    expect(outcome).toEqual({ kind: 'done', esptoolError: 'Failed to connect to ESP32-C3' })
    expect(finalState(fc)).toEqual(RESTORED)
  })

  it('keeps the values saved by an interrupted run rather than the ones it left', async () => {
    const fc = new FakeFc()
    const state = new MemoryState()
    state.value = { SERIAL_PASSTIMO: 15 }
    fc.params.set('SERIAL_PASSTIMO', 5)
    await writeReceiver(opts(fc, state), async () => {})
    expect(fc.params.get('SERIAL_PASSTIMO')).toBe(15)
  })

  it('skips the setup reboot when the board is already configured', async () => {
    const fc = new FakeFc()
    for (const [k, v] of Object.entries({
      SERIAL2_PROTOCOL: 28,
      RELAY1_FUNCTION: 1,
      RELAY1_PIN: 71,
      RELAY1_DEFAULT: 1,
      RELAY2_FUNCTION: 1,
      RELAY2_PIN: 70,
      RELAY2_DEFAULT: 1,
    })) {
      fc.params.set(k, v)
    }
    fc.booted = new Map(fc.params)
    await writeReceiver(opts(fc), async () => {})
    expect(fc.reboots).toBe(1)
  })

  it('also clears another relay left on EN', async () => {
    const fc = new FakeFc()
    fc.params.set('RELAY3_FUNCTION', 1)
    fc.params.set('RELAY3_PIN', 70)
    await writeReceiver(opts(fc), async () => {})
    expect(fc.params.get('RELAY3_FUNCTION')).toBe(0)
    expect(fc.params.get('RELAY3_PIN')).toBe(-1)
  })
})

describe('interruptedRun', () => {
  const protocols = new Set([28])
  it('sees a relay on BOOT or EN, or the passthrough protocol', () => {
    expect(interruptedRun(new Map([['SERIAL2_PROTOCOL', 23]]), wiring, protocols)).toBe(false)
    expect(interruptedRun(new Map([['RELAY1_PIN', 71]]), wiring, protocols)).toBe(true)
    expect(interruptedRun(new Map([['RELAY4_PIN', 70]]), wiring, protocols)).toBe(true)
    expect(interruptedRun(new Map([['SERIAL2_PROTOCOL', 28]]), wiring, protocols)).toBe(true)
    expect(interruptedRun(new Map([['RELAY1_PIN', 50]]), wiring, protocols)).toBe(false)
  })
})
