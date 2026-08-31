import { describe, expect, it } from 'vitest'
import { MissionClient } from './mission'
import type { FieldValue, MissionItem } from './types'

// A scripted vehicle end of the handshake. Short step timeout so the stall
// paths run in milliseconds instead of seconds.
function harness(stepMs = 25) {
  const sent: { msgName: string; fields: Record<string, FieldValue> }[] = []
  const client = new MissionClient(
    (msgName, fields) => sent.push({ msgName, fields }),
    () => ({ sysid: 1, compid: 1 }),
    stepMs,
  )
  return { sent, client, last: () => sent[sent.length - 1]! }
}

function item(seq: number, over: Partial<MissionItem> = {}): MissionItem {
  return {
    seq,
    frame: 3,
    command: 16,
    current: seq === 0 ? 1 : 0,
    autocontinue: 1,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    x: Math.round((-35.363 + seq * 0.001) * 1e7),
    y: Math.round(149.165 * 1e7),
    z: 50,
    ...over,
  }
}

const wire = (i: MissionItem, missionType = 0) => ({ ...i, missionType }) as never

describe('download', () => {
  it('requests items in order and acks the end', async () => {
    const { sent, client, last } = harness()
    const items = [item(0), item(1), item(2)]
    const progress: number[] = []
    const done = client.download(0, (got) => progress.push(got))

    expect(last().msgName).toBe('MISSION_REQUEST_LIST')
    client.handleMessage('MISSION_COUNT', { count: 3, missionType: 0 })
    for (const i of items) {
      expect(last()).toMatchObject({ msgName: 'MISSION_REQUEST_INT', fields: { seq: i.seq } })
      client.handleMessage('MISSION_ITEM_INT', wire(i))
    }
    expect(last()).toMatchObject({ msgName: 'MISSION_ACK', fields: { type: 0 } })

    const got = await done
    expect(got).toHaveLength(3)
    expect(got[1]).toMatchObject({ seq: 1, command: 16, z: 50 })
    expect(progress).toEqual([1, 2, 3])
    expect(sent.filter((s) => s.msgName === 'MISSION_REQUEST_INT')).toHaveLength(3)
  })

  it('resolves an empty mission without requesting anything', async () => {
    const { sent, client } = harness()
    const done = client.download()
    client.handleMessage('MISSION_COUNT', { count: 0, missionType: 0 })
    expect(await done).toEqual([])
    expect(sent.some((s) => s.msgName === 'MISSION_REQUEST_INT')).toBe(false)
    // The vehicle is still owed an ack, or it retries the count at us.
    expect(sent[sent.length - 1]!.msgName).toBe('MISSION_ACK')
  })

  it('drops duplicates and out-of-order items rather than corrupting the list', async () => {
    const { client, last } = harness()
    const done = client.download()
    client.handleMessage('MISSION_COUNT', { count: 2, missionType: 0 })
    client.handleMessage('MISSION_ITEM_INT', wire(item(0)))
    // A duplicate of 0 and a premature 2 both arrive; neither is item 1.
    client.handleMessage('MISSION_ITEM_INT', wire(item(0)))
    client.handleMessage('MISSION_ITEM_INT', wire(item(2)))
    expect(last()).toMatchObject({ msgName: 'MISSION_REQUEST_INT', fields: { seq: 1 } })
    client.handleMessage('MISSION_ITEM_INT', wire(item(1)))
    const got = await done
    expect(got.map((i) => i.seq)).toEqual([0, 1])
  })

  it('re-requests a lost item, then gives up with a message naming it', async () => {
    const { sent, client } = harness()
    const done = client.download()
    client.handleMessage('MISSION_COUNT', { count: 2, missionType: 0 })
    client.handleMessage('MISSION_ITEM_INT', wire(item(0)))
    // Item 1 never comes.
    await expect(done).rejects.toThrow(/no item 1 of 2/)
    const requests = sent.filter(
      (s) => s.msgName === 'MISSION_REQUEST_INT' && s.fields.seq === 1,
    )
    expect(requests.length).toBeGreaterThan(2)
  })

  it('retries a silent MISSION_REQUEST_LIST before failing', async () => {
    const { sent, client } = harness()
    await expect(client.download()).rejects.toThrow(/no MISSION_COUNT/)
    expect(sent.filter((s) => s.msgName === 'MISSION_REQUEST_LIST').length).toBeGreaterThan(2)
  })

  it('ignores messages for a different mission type', async () => {
    const { client, last } = harness()
    const done = client.download(0)
    // A fence count arriving mid-download of the mission must not be taken
    // as ours -- mistaking one for the other swaps missions and fences.
    client.handleMessage('MISSION_COUNT', { count: 5, missionType: 1 })
    expect(last().msgName).toBe('MISSION_REQUEST_LIST')
    client.handleMessage('MISSION_COUNT', { count: 1, missionType: 0 })
    client.handleMessage('MISSION_ITEM_INT', wire(item(0)))
    expect(await done).toHaveLength(1)
  })
})

describe('upload', () => {
  it('announces a count, answers requests, and resolves on the ack', async () => {
    const { sent, client, last } = harness()
    const items = [item(0), item(1), item(2)]
    const done = client.upload(items)

    expect(last()).toMatchObject({ msgName: 'MISSION_COUNT', fields: { count: 3 } })
    for (let seq = 0; seq < 3; seq++) {
      client.handleMessage('MISSION_REQUEST_INT', { seq, missionType: 0 })
      expect(last()).toMatchObject({
        msgName: 'MISSION_ITEM_INT',
        fields: { seq, x: items[seq]!.x },
      })
    }
    client.handleMessage('MISSION_ACK', { type: 0, missionType: 0 })
    await done
    expect(sent.filter((s) => s.msgName === 'MISSION_ITEM_INT')).toHaveLength(3)
  })

  it('answers the deprecated MISSION_REQUEST with MISSION_ITEM_INT', async () => {
    // Older firmware asks with the float-era message; the spec's upgrade path
    // is to answer with the INT item regardless.
    const { client, last } = harness()
    const done = client.upload([item(0)])
    client.handleMessage('MISSION_REQUEST', { seq: 0, missionType: 0 })
    expect(last().msgName).toBe('MISSION_ITEM_INT')
    client.handleMessage('MISSION_ACK', { type: 0, missionType: 0 })
    await done
  })

  it('answers a re-request for the same item again', async () => {
    const { sent, client } = harness()
    const done = client.upload([item(0), item(1)])
    client.handleMessage('MISSION_REQUEST_INT', { seq: 0, missionType: 0 })
    client.handleMessage('MISSION_REQUEST_INT', { seq: 0, missionType: 0 })
    client.handleMessage('MISSION_REQUEST_INT', { seq: 1, missionType: 0 })
    client.handleMessage('MISSION_ACK', { type: 0, missionType: 0 })
    await done
    expect(
      sent.filter((s) => s.msgName === 'MISSION_ITEM_INT' && s.fields.seq === 0),
    ).toHaveLength(2)
  })

  it('turns a rejecting ack into the reason by name', async () => {
    const { client } = harness()
    const done = client.upload([item(0), item(1, { frame: 99 })])
    client.handleMessage('MISSION_REQUEST_INT', { seq: 0, missionType: 0 })
    client.handleMessage('MISSION_REQUEST_INT', { seq: 1, missionType: 0 })
    client.handleMessage('MISSION_ACK', { type: 2, missionType: 0 })
    await expect(done).rejects.toThrow(/Unsupported frame/)
  })

  it('resends the count when the vehicle never starts requesting', async () => {
    const { sent, client } = harness()
    await expect(client.upload([item(0)])).rejects.toThrow(/never requested/)
    expect(sent.filter((s) => s.msgName === 'MISSION_COUNT').length).toBeGreaterThan(2)
  })

  it('nudges a stalled vehicle by resending the last item', async () => {
    const { sent, client } = harness()
    const done = client.upload([item(0), item(1)])
    client.handleMessage('MISSION_REQUEST_INT', { seq: 0, missionType: 0 })
    // Vehicle goes quiet: its request for 1 (or its ack) was lost. The
    // resend of item 0 is what prompts it to re-request.
    await expect(done).rejects.toThrow(/stalled after item 0/)
    expect(
      sent.filter((s) => s.msgName === 'MISSION_ITEM_INT' && s.fields.seq === 0).length,
    ).toBeGreaterThan(2)
  })
})

describe('housekeeping', () => {
  it('clears with an acked MISSION_CLEAR_ALL', async () => {
    const { client, last } = harness()
    const done = client.clearAll()
    expect(last().msgName).toBe('MISSION_CLEAR_ALL')
    client.handleMessage('MISSION_ACK', { type: 0, missionType: 0 })
    await done
  })

  it('refuses a second transfer while one runs', async () => {
    const { client } = harness()
    const first = client.download()
    await expect(client.download()).rejects.toThrow(/already running/)
    client.abort('test over')
    await expect(first).rejects.toThrow(/test over/)
  })

  it('aborts cleanly on link loss', async () => {
    const { client } = harness(5000)
    const done = client.upload([item(0)])
    client.abort('link closed')
    await expect(done).rejects.toThrow(/link closed/)
    // And the next transfer is allowed to start.
    const again = client.download()
    client.handleMessage('MISSION_COUNT', { count: 0, missionType: 0 })
    expect(await again).toEqual([])
  })
})
