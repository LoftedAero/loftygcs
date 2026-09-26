import { describe, expect, it } from 'vitest'
import { rebootCandidates, siblingsOf } from './reboot-port'

const port = (name: string, info: SerialPortInfo) =>
  ({ name, getInfo: () => info }) as unknown as SerialPort & { name: string }
const CUBE = { usbVendorId: 0x2dae, usbProductId: 0x1016 }

const names = (ps: SerialPort[]) => ps.map((p) => (p as unknown as { name: string }).name)

describe('choosing the port to reopen after a reboot', () => {
  // As a Cube Orange enumerates: MAVLink first, SLCAN second, same ids.
  const mavlink = port('COM36', CUBE)
  const slcan = port('COM38', CUBE)
  const bluetooth = port('COM3', {})

  it('keeps only the ports that share the held port’s ids', () => {
    expect(names(siblingsOf([bluetooth, mavlink, slcan], mavlink))).toEqual(['COM36', 'COM38'])
  })

  it('tries the port in the picked port’s position first, not the newest', () => {
    // After the reboot both are new objects; the picked one was first of two.
    const again = [port('COM36', CUBE), port('COM38', CUBE)]
    expect(names(rebootCandidates(again, 0, 0))).toEqual(['COM36', 'COM38'])
  })

  it('moves past a port that opened but sent no heartbeat', () => {
    const again = [port('COM36', CUBE), port('COM38', CUBE)]
    expect(names(rebootCandidates(again, 1, 0))).toEqual(['COM38', 'COM36'])
    expect(names(rebootCandidates(again, 1, 1))).toEqual(['COM36', 'COM38'])
  })

  it('offers nothing to choose between for a port without USB ids', () => {
    expect(siblingsOf([bluetooth], bluetooth)).toEqual([])
    expect(rebootCandidates([], 0, 0)).toEqual([])
  })
})
