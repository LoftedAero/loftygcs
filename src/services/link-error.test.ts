import { describe, expect, it } from 'vitest'
import { cleanMessage, describeLinkError, isCancellation, linkTarget } from './link-error'
import type { TransportOptions } from '../transport/Transport'

const TCP: TransportOptions = { kind: 'tcp', host: '127.0.0.1', port: 5760 }
const UDP: TransportOptions = { kind: 'udp', localPort: 14550 }

// The exact string the app bar showed when a simulator was not running.
const REAL = new Error(
  "Error invoking remote method 'link:open': Error: connect ECONNREFUSED 127.0.0.1:5760",
)

describe('describing a link that would not open', () => {
  it('turns the reported failure into one sentence', () => {
    expect(describeLinkError(REAL, TCP)).toBe('Nothing is listening at 127.0.0.1:5760.')
  })

  it('names what the user asked for, not what the socket was doing', () => {
    // The code is matched, never the address inside the message: a UDP bind
    // failure names the port that was asked for.
    const inUse = new Error('bind EADDRINUSE 0.0.0.0:14550')
    expect(describeLinkError(inUse, UDP)).toBe('Something is already using port 14550.')
  })

  it('covers the failures a wrong address produces', () => {
    expect(describeLinkError(new Error('connect ETIMEDOUT 10.0.0.9:5760'), TCP)).toBe(
      '127.0.0.1:5760 did not respond.',
    )
    expect(describeLinkError(new Error('getaddrinfo ENOTFOUND nosuch.local'), TCP)).toBe(
      'Cannot find 127.0.0.1:5760.',
    )
    expect(describeLinkError(new Error('connect EHOSTUNREACH 10.0.0.9:5760'), TCP)).toBe(
      '127.0.0.1:5760 is unreachable.',
    )
  })

  it('says the unknown plainly rather than guessing', () => {
    // No code to match. Repeating what happened beats inventing a cause.
    expect(describeLinkError(new Error('Something odd happened'), TCP)).toBe(
      'Something odd happened',
    )
    expect(describeLinkError(new Error(''), TCP)).toBe('The connection failed.')
  })

  it('is silent when the chooser was cancelled', () => {
    // Pressing Cancel is not a failure and must not put a red chip on the
    // bar for choosing not to connect.
    const cancelled = new Error('No port selected by the user.')
    expect(describeLinkError(cancelled, { kind: 'serial', baudRate: 115200 })).toBeNull()
    expect(isCancellation(cancelled)).toBe(true)
    expect(isCancellation(new Error('connect ECONNREFUSED 127.0.0.1:5760'))).toBe(false)
  })
})

describe('stripping the plumbing off a message', () => {
  it('removes the IPC wrapper and every Error: it left behind', () => {
    expect(cleanMessage(REAL.message)).toBe('connect ECONNREFUSED 127.0.0.1:5760')
    expect(cleanMessage('Error: Error: doubled')).toBe('doubled')
    expect(cleanMessage('plain')).toBe('plain')
  })
})

describe('naming the target', () => {
  it('uses the words the user typed', () => {
    expect(linkTarget(TCP)).toBe('127.0.0.1:5760')
    expect(linkTarget(UDP)).toBe('port 14550')
    expect(linkTarget({ kind: 'ws', url: 'ws://127.0.0.1:5678' })).toBe('ws://127.0.0.1:5678')
    expect(linkTarget({ kind: 'serial', baudRate: 115200 })).toBe('the serial port')
  })
})
