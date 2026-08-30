import { describe, expect, it } from 'vitest'
import { CommandClient } from './commands'
import type { FieldValue } from './types'

function makeClient() {
  const sent: Record<string, FieldValue>[] = []
  const client = new CommandClient(
    (_msgName, fields) => sent.push(fields),
    () => ({ sysid: 1, compid: 1 }),
  )
  return { client, sent }
}

describe('CommandClient', () => {
  it('resolves with the MAV_RESULT from the ack', async () => {
    const { client, sent } = makeClient()
    const done = client.run(209, [1, 0, 10, 2])
    expect(sent[0]!.command).toBe(209)
    expect(sent[0]!._param3).toBe(10)
    client.handleAck({ command: 209, result: 0 })
    await expect(done).resolves.toBe(0)
  })

  it('resolves with a rejection code rather than throwing', async () => {
    const { client } = makeClient()
    const done = client.run(400, [1])
    client.handleAck({ command: 400, result: 2 }) // DENIED
    await expect(done).resolves.toBe(2)
  })

  it('keeps waiting through IN_PROGRESS acks', async () => {
    const { client } = makeClient()
    const done = client.run(241, [0, 0, 0, 0, 1])
    client.handleAck({ command: 241, result: 5 }) // IN_PROGRESS
    client.handleAck({ command: 241, result: 0 })
    await expect(done).resolves.toBe(0)
  })

  it('ignores acks for other commands', async () => {
    const { client } = makeClient()
    const done = client.run(209, [1])
    client.handleAck({ command: 400, result: 0 })
    client.handleAck({ command: 209, result: 4 })
    await expect(done).resolves.toBe(4)
  })
})
