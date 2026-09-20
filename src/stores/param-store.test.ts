import { beforeEach, describe, expect, it } from 'vitest'
import { useParamStore, type ParamEntry } from './param-store'
import { useParamLogStore } from './param-log-store'

// param-store is the one place every parameter change in the app actually
// passes through -- every screen's ParamField, every switch, every wizard.
// These tests hold that param-log-store's narration of the Parameters
// screen's change log stays wired to it: staging logs a pending line,
// writing commits it, reverting withdraws it, and a new session clears it.
// The log's own bookkeeping (coalescing, withdrawal-on-return) is covered in
// param-log-store.test.ts; this file is only about the wiring.

function seed(value: number): ParamEntry {
  return { value, origValue: value, mavType: 9, dirty: false }
}

beforeEach(() => {
  useParamStore.setState({
    entries: new Map([
      ['MOT_SPIN_MIN', seed(0.1)],
      ['MOT_SPIN_MAX', seed(0.95)],
    ]),
    order: ['MOT_SPIN_MAX', 'MOT_SPIN_MIN'],
    dirtyCount: 0,
  })
  useParamLogStore.getState().reset()
})

describe('param-store -> param-log-store wiring', () => {
  it('edit opens a pending line', () => {
    useParamStore.getState().edit('MOT_SPIN_MIN', 0.2)
    expect(useParamLogStore.getState().lines).toMatchObject([
      { param: 'MOT_SPIN_MIN', from: 0.1, to: 0.2, status: 'pending' },
    ])
  })

  it('confirmWrite commits the matching line', () => {
    useParamStore.getState().edit('MOT_SPIN_MIN', 0.2)
    useParamStore.getState().confirmWrite('MOT_SPIN_MIN', 0.2)
    expect(useParamLogStore.getState().lines).toMatchObject([
      { param: 'MOT_SPIN_MIN', from: 0.1, to: 0.2, status: 'committed' },
    ])
  })

  it('revertAll withdraws every still-open line it reverts', () => {
    useParamStore.getState().edit('MOT_SPIN_MIN', 0.2)
    useParamStore.getState().edit('MOT_SPIN_MAX', 0.9)
    useParamStore.getState().revertAll()
    expect(useParamLogStore.getState().lines).toEqual([])
  })

  it('revertAll leaves an already-committed line alone', () => {
    useParamStore.getState().edit('MOT_SPIN_MIN', 0.2)
    useParamStore.getState().confirmWrite('MOT_SPIN_MIN', 0.2)
    useParamStore.getState().edit('MOT_SPIN_MAX', 0.9)
    useParamStore.getState().revertAll()
    expect(useParamLogStore.getState().lines).toMatchObject([
      { param: 'MOT_SPIN_MIN', status: 'committed' },
    ])
  })

  it('reset clears the change log along with the parameter table', () => {
    useParamStore.getState().edit('MOT_SPIN_MIN', 0.2)
    useParamStore.getState().reset()
    expect(useParamLogStore.getState().lines).toEqual([])
  })
})
