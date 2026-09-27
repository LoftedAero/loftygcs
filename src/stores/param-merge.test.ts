import { beforeEach, describe, expect, it } from 'vitest'
import { useParamStore } from './param-store'
import type { ParamRecord } from '../protocol/types'

// A background refresh must keep staged edits. `loaded` rebuilds from scratch
// (flipping `loadState` and dropping dirty entries), so a refresh uses `merged`.

const rec = (name: string, value: number): ParamRecord => ({ name, value, mavType: 4 })

beforeEach(() => {
  useParamStore.getState().loaded([rec('OSD_TYPE', 0), rec('ATC_RAT_PIT_P', 0.135)])
})

describe('merging a refreshed parameter set', () => {
  it('keeps an edit the user has staged but not written', () => {
    const s = useParamStore.getState()
    s.edit('ATC_RAT_PIT_P', 0.2)
    expect(useParamStore.getState().entries.get('ATC_RAT_PIT_P')?.dirty).toBe(true)

    useParamStore.getState().merged([rec('OSD_TYPE', 1), rec('ATC_RAT_PIT_P', 0.135)])

    const after = useParamStore.getState().entries.get('ATC_RAT_PIT_P')
    expect(after?.value).toBe(0.2) // still what they chose
    expect(after?.origValue).toBe(0.135) // still staged against the vehicle's
    expect(after?.dirty).toBe(true)
    expect(useParamStore.getState().dirtyCount).toBe(1)
  })

  it('clears an edit the vehicle has caught up with', () => {
    // The OSD_TYPE case: written, then read back. It is no longer an edit.
    useParamStore.getState().edit('OSD_TYPE', 1)
    useParamStore.getState().merged([rec('OSD_TYPE', 1)])
    const after = useParamStore.getState().entries.get('OSD_TYPE')
    expect(after?.dirty).toBe(false)
    expect(useParamStore.getState().dirtyCount).toBe(0)
  })

  it('picks up parameters the vehicle did not report before', () => {
    // OSD_TYPE gates the panel subtree, which is why the refresh exists.
    expect(useParamStore.getState().entries.has('OSD1_ALTITUDE_EN')).toBe(false)
    useParamStore.getState().merged([rec('OSD_TYPE', 1), rec('OSD1_ALTITUDE_EN', 1)])
    expect(useParamStore.getState().entries.has('OSD1_ALTITUDE_EN')).toBe(true)
  })

  it('leaves the load state alone, so nothing blanks while it runs', () => {
    expect(useParamStore.getState().loadState).toBe('ready')
    useParamStore.getState().merged([rec('OSD_TYPE', 1)])
    expect(useParamStore.getState().loadState).toBe('ready')
  })

  it('refreshes a clean value from the vehicle', () => {
    useParamStore.getState().merged([rec('OSD_TYPE', 5), rec('ATC_RAT_PIT_P', 0.135)])
    expect(useParamStore.getState().entries.get('OSD_TYPE')?.value).toBe(5)
  })
})
