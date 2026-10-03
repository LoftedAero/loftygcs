import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RttEstimator } from '../link-timing'
import { ParamStreamClient } from './param-client'
import type { FieldValue } from '../types'

function makeClient() {
  const sent: { msgName: string; fields: Record<string, FieldValue> }[] = []
  const client = new ParamStreamClient(
    (msgName, fields) => sent.push({ msgName, fields }),
    () => ({ sysid: 1, compid: 1 }),
  )
  const paramValue = (name: string, value: number, index: number, count: number) =>
    client.handleParamValue({
      paramId: name,
      paramValue: value,
      paramType: 9,
      paramIndex: index,
      paramCount: count,
    })
  return { client, sent, paramValue }
}

describe('ParamStreamClient', () => {
  it('downloads a complete stream', async () => {
    const { client, sent, paramValue } = makeClient()
    const done = client.downloadAll(() => {})
    expect(sent[0]!.msgName).toBe('PARAM_REQUEST_LIST')
    paramValue('AAA', 1, 0, 3)
    paramValue('BBB', 2, 1, 3)
    paramValue('CCC', 3, 2, 3)
    const params = await done
    expect(params.map((p) => p.name)).toEqual(['AAA', 'BBB', 'CCC'])
    client.abort('test done')
  })

  it('resolves a PARAM_SET when the echo arrives', async () => {
    const { client, sent, paramValue } = makeClient()
    const done = client.setParam('LOIT_SPEED', 1500, 9)
    expect(sent[0]!.msgName).toBe('PARAM_SET')
    expect(sent[0]!.fields.paramValue).toBe(1500)
    paramValue('LOIT_SPEED', 1500, 65535, 100)
    await expect(done).resolves.toBe(1500)
  })

  describe('gap refetch', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    const reads = (sent: { msgName: string; fields: Record<string, FieldValue> }[]) =>
      sent.filter((s) => s.msgName === 'PARAM_REQUEST_READ').map((s) => s.fields.paramIndex)

    it('asks for gaps a few at a time and finishes when they arrive', async () => {
      const { client, sent, paramValue } = makeClient()
      const done = client.downloadAll(() => {})
      paramValue('P0', 0, 0, 20) // then the stream dies: 19 missing
      await vi.advanceTimersByTimeAsync(3000)
      expect(reads(sent)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
      // Each answer frees a slot for the next request.
      paramValue('P1', 1, 1, 20)
      expect(reads(sent)).toContain(9)
      for (let i = 2; i < 20; i++) paramValue(`P${i}`, i, i, 20)
      const params = await done
      expect(params).toHaveLength(20)
    })

    it('retries an unanswered index and gives up after a bounded number of tries', async () => {
      const { client, sent, paramValue } = makeClient()
      const done = client.downloadAll(() => {})
      const failed = expect(done).rejects.toThrow('1 of 2 missing')
      paramValue('P0', 0, 0, 2)
      // Each retry waits twice as long: 1, 2, 4, 8, then 10 s (the cap) twice.
      await vi.advanceTimersByTimeAsync(3000 + 35000)
      expect(reads(sent)).toEqual([1, 1, 1, 1, 1, 1])
      await failed
    })

    it('waits longer on a link measured as slow', async () => {
      const rtt = new RttEstimator()
      for (let i = 0; i < 5; i++) rtt.sample(2500)
      const sent: { msgName: string; fields: Record<string, FieldValue> }[] = []
      const client = new ParamStreamClient(
        (msgName, fields) => sent.push({ msgName, fields }),
        () => ({ sysid: 1, compid: 1 }),
        rtt,
      )
      const done = client.downloadAll(() => {})
      client.handleParamValue({
        paramId: 'P0',
        paramValue: 0,
        paramType: 9,
        paramIndex: 0,
        paramCount: 2,
      })
      // A 3 s stall timeout would already have refetched; the slow link has not.
      await vi.advanceTimersByTimeAsync(3000)
      expect(reads(sent)).toEqual([])
      await vi.advanceTimersByTimeAsync(rtt.timeout(3000))
      expect(reads(sent)).toEqual([1])
      client.handleParamValue({
        paramId: 'P1',
        paramValue: 1,
        paramType: 9,
        paramIndex: 1,
        paramCount: 2,
      })
      await expect(done).resolves.toHaveLength(2)
    })
  })

  it('a set echo during a download does not corrupt the index map', async () => {
    const { client, paramValue } = makeClient()
    const done = client.downloadAll(() => {})
    paramValue('AAA', 1, 0, 2)
    paramValue('ZZZ', 9, 65535, 2) // unsolicited set echo mid-download
    paramValue('BBB', 2, 1, 2)
    const params = await done
    expect(params.map((p) => p.name)).toEqual(['AAA', 'BBB'])
    client.abort('test done')
  })
})
