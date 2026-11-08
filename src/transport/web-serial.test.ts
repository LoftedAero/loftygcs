import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSerialTransport } from './web-serial'

// A port whose readable errors with `script` in turn, replacing the stream
// after a line error as Chromium does, and dropping it after any other.
function fakePort(script: (Uint8Array | DOMException)[]) {
  let step = 0
  const port = {
    readable: null as ReadableStream<Uint8Array> | null,
    writable: new WritableStream<Uint8Array>(),
    open: vi.fn(async () => {
      port.readable = next()
    }),
    close: vi.fn(async () => {}),
  }
  const next = () =>
    new ReadableStream<Uint8Array>({
      pull(ctl) {
        const item = script[step++]
        if (item === undefined) return new Promise(() => {}) // quiet line
        if (item instanceof DOMException) {
          const lineError = item.name !== 'NetworkError'
          port.readable = lineError ? next() : null
          ctl.error(item)
        } else {
          ctl.enqueue(item)
        }
      },
    })
  return port
}

beforeEach(() => {
  Object.defineProperty(navigator, 'serial', { value: {}, configurable: true })
})
afterEach(() => {
  Reflect.deleteProperty(navigator, 'serial')
})

async function run(script: (Uint8Array | DOMException)[]) {
  const port = fakePort(script)
  const t = new WebSerialTransport(port as unknown as SerialPort)
  const data: number[] = []
  const closed: (string | undefined)[] = []
  t.onData((b) => data.push(...b))
  t.onClose((r) => closed.push(r))
  await t.open({ kind: 'serial', baudRate: 57600 })
  await vi.waitFor(() => expect(data.length + closed.length).toBeGreaterThanOrEqual(3))
  return { data, closed }
}

describe('the USB serial read loop', () => {
  it('reads on through a break, as a SiK radio sends when it powers up', async () => {
    const { data, closed } = await run([
      new Uint8Array([1]),
      new DOMException('Break received', 'BreakError'),
      new Uint8Array([2]),
      new DOMException('Framing error', 'FramingError'),
      new Uint8Array([3]),
    ])
    expect(data).toEqual([1, 2, 3])
    expect(closed).toEqual([])
  })

  it('closes once when the device goes away', async () => {
    const { data, closed } = await run([
      new Uint8Array([1, 2]),
      new DOMException('The device has been lost.', 'NetworkError'),
    ])
    expect(data).toEqual([1, 2])
    expect(closed).toEqual(['The device has been lost.'])
  })
})
