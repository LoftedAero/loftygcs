import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// What a Flash press finds decides between the wizard and an update, so these
// pin each outcome against fake USB and serial devices.

const env = vi.hoisted(() => ({ electron: false }))
vi.mock('../env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../env')>()),
  isElectron: () => env.electron,
}))

const flash = vi.hoisted(() => ({ identifyBoard: vi.fn() }))
vi.mock('./flash', () => ({
  identifyBoard: flash.identifyBoard,
  bootBoard: vi.fn(),
  flashDfu: vi.fn(),
  flashSerial: vi.fn(),
  rebootToBootloader: vi.fn(),
}))

import { detectBoard, firmwarePort, nextArduPilotPort } from './board-setup'

const DFU = { vendorId: 0x0483, productId: 0xdf11 } as USBDevice
const ardupilotPort = { getInfo: () => ({ usbVendorId: 0x1209, usbProductId: 0x5741 }) }
const otherPort = { getInfo: () => ({ usbVendorId: 0x10c4, usbProductId: 0xea60 }) }

let usbDevices: USBDevice[]
let usbChosen: USBDevice | null
let serialPorts: unknown[]

beforeEach(() => {
  env.electron = false
  usbDevices = []
  usbChosen = null
  serialPorts = []
  flash.identifyBoard.mockReset()
  Object.defineProperty(navigator, 'usb', {
    configurable: true,
    value: {
      getDevices: () => Promise.resolve(usbDevices),
      requestDevice: () =>
        usbChosen ? Promise.resolve(usbChosen) : Promise.reject(new Error('NotFoundError')),
    },
  })
  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: {
      getPorts: () => Promise.resolve(serialPorts),
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  })
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'usb')
  Reflect.deleteProperty(navigator, 'serial')
})

const step = () => {}
const inBootloader = { boardId: 5999, port: ardupilotPort }

describe('detectBoard', () => {
  it('takes a board already in DFU as a first flash, touching no serial port', async () => {
    usbDevices = [DFU]
    expect(await detectBoard(step)).toEqual({ kind: 'dfu', device: DFU })
    expect(flash.identifyBoard).not.toHaveBeenCalled()
  })

  describe('in the desktop app', () => {
    beforeEach(() => {
      env.electron = true
    })

    it('finds nothing, and asks nothing, with no ArduPilot port plugged in', async () => {
      // A blank board plugged in normally has no USB device at all.
      serialPorts = [otherPort]
      expect(await detectBoard(step)).toEqual({ kind: 'none' })
      expect(flash.identifyBoard).not.toHaveBeenCalled()
    })

    it('reboots a board running ArduPilot into its bootloader for an update', async () => {
      serialPorts = [otherPort, ardupilotPort]
      flash.identifyBoard.mockResolvedValue(inBootloader)
      expect(await detectBoard(step)).toEqual({ kind: 'bootloader', board: inBootloader })
      expect(flash.identifyBoard).toHaveBeenCalledWith(expect.objectContaining({ reboot: true }))
    })

    it('reports an ArduPilot port whose bootloader never answered', async () => {
      serialPorts = [ardupilotPort]
      flash.identifyBoard.mockRejectedValue(new Error('not reachable'))
      await expect(detectBoard(step)).rejects.toThrow('not reachable')
    })
  })

  describe('in a browser', () => {
    it('offers the DFU chooser when no bootloader answered on the serial one', async () => {
      flash.identifyBoard.mockRejectedValue(new Error('canceled'))
      usbChosen = DFU
      expect(await detectBoard(step)).toEqual({ kind: 'dfu', device: DFU })
    })

    it('finds nothing when both choosers are canceled', async () => {
      flash.identifyBoard.mockRejectedValue(new Error('canceled'))
      expect(await detectBoard(step)).toEqual({ kind: 'none' })
    })
  })
})

describe('finding ArduPilot after a write, with no chooser', () => {
  // Each a distinct object, as Web Serial hands out for each USB device.
  const port = () =>
    ({ getInfo: () => ({ usbVendorId: 0x1209, usbProductId: 0x5741 }) }) as unknown as SerialPort

  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits out the bootloader that comes up after DFU, and takes the port after it', async () => {
    const bootloader = port()
    const ardupilot = port()
    const found = firmwarePort(null)
    await vi.advanceTimersByTimeAsync(800)
    serialPorts = [bootloader]
    await vi.advanceTimersByTimeAsync(4000)
    serialPorts = []
    await vi.advanceTimersByTimeAsync(1000)
    serialPorts = [ardupilot]
    await vi.advanceTimersByTimeAsync(500)
    expect(await found).toBe(ardupilot)
  })

  it('takes a port that first appears after the bootloader would have finished', async () => {
    const ardupilot = port()
    const found = firmwarePort(null)
    await vi.advanceTimersByTimeAsync(6000)
    serialPorts = [ardupilot]
    await vi.advanceTimersByTimeAsync(500)
    expect(await found).toBe(ardupilot)
  })

  it('after an update, takes the port that replaces the bootloader it wrote through', async () => {
    const bootloader = port()
    const ardupilot = port()
    serialPorts = [otherPort, bootloader]
    const found = firmwarePort(bootloader)
    await vi.advanceTimersByTimeAsync(1000)
    serialPorts = [otherPort]
    await vi.advanceTimersByTimeAsync(1000)
    serialPorts = [otherPort, ardupilot]
    await vi.advanceTimersByTimeAsync(500)
    expect(await found).toBe(ardupilot)
  })

  it('gives up when the board never comes back', async () => {
    const bootloader = port()
    serialPorts = [bootloader]
    const found = firmwarePort(bootloader, 3000)
    await vi.advanceTimersByTimeAsync(3500)
    expect(await found).toBeNull()
  })

  it('hears a replug as a port that is new since the wait began', async () => {
    const before = port()
    const after = port()
    serialPorts = [before]
    const found = nextArduPilotPort(10000)
    await vi.advanceTimersByTimeAsync(1000)
    serialPorts = []
    await vi.advanceTimersByTimeAsync(1000)
    serialPorts = [after]
    await vi.advanceTimersByTimeAsync(500)
    expect(await found).toBe(after)
  })
})
