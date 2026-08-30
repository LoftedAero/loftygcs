import { beforeEach, describe, expect, it } from 'vitest'
import { useGuideStore } from './guide-store'

describe('guide store', () => {
  beforeEach(() => {
    useGuideStore.getState().exitGuide()
    useGuideStore.getState().selectProfile(null)
  })

  it('starting a guide declares the aircraft', () => {
    useGuideStore.getState().startGuide('lofted-f35b', 'f35b-bringup')
    const s = useGuideStore.getState()
    expect(s.activeGuide).toEqual({ profileId: 'lofted-f35b', guideId: 'f35b-bringup' })
    expect(s.selectedProfileId).toBe('lofted-f35b')
    expect(s.stepIndex).toBe(0)
  })

  it('tracks per-step status and survives navigation', () => {
    const store = useGuideStore.getState()
    store.startGuide('lofted-f35b', 'f35b-bringup')
    store.markStep(0, 'done')
    store.gotoStep(1)
    store.markStep(1, 'skipped')
    store.gotoStep(0)
    const s = useGuideStore.getState()
    expect(s.stepStatus[0]).toBe('done')
    expect(s.stepStatus[1]).toBe('skipped')
    expect(s.stepIndex).toBe(0)
  })

  it('exiting clears the run but keeps the aircraft selection', () => {
    const store = useGuideStore.getState()
    store.startGuide('lofted-f35b', 'f35b-bringup')
    store.markStep(0, 'done')
    store.exitGuide()
    const s = useGuideStore.getState()
    expect(s.activeGuide).toBeNull()
    expect(s.stepStatus).toEqual({})
    // The user said what aircraft this is; that outlives one guide run.
    expect(s.selectedProfileId).toBe('lofted-f35b')
  })
})
