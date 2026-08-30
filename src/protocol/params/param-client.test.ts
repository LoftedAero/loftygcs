import { describe, expect, it } from 'vitest'
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
