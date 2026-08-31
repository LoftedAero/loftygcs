import { beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from './ui-store'
import { useParamStore } from './param-store'

// The guard that turns a global dirty set back into a per-page transaction.

function stageEdit() {
  useParamStore.getState().loaded([{ name: 'ANGLE_MAX', value: 3000, mavType: 9 }])
  useParamStore.getState().edit('ANGLE_MAX', 4500)
}

beforeEach(() => {
  useParamStore.getState().reset()
  useUiStore.setState({ mode: 'setup', activeTab: 'overview', pendingNav: null })
})

describe('with nothing staged', () => {
  it('navigates straight away', () => {
    useUiStore.getState().setMode('fly')
    expect(useUiStore.getState().mode).toBe('fly')
    expect(useUiStore.getState().pendingNav).toBeNull()
  })

  it('a tab also returns to Setup, since picking one implies wanting the rail', () => {
    useUiStore.setState({ mode: 'fly' })
    useUiStore.getState().setTab('radio')
    expect(useUiStore.getState()).toMatchObject({ mode: 'setup', activeTab: 'radio' })
  })
})

describe('with staged edits', () => {
  beforeEach(stageEdit)

  it('holds a mode change instead of making it', () => {
    useUiStore.getState().setMode('mission')
    expect(useUiStore.getState().mode).toBe('setup')
    expect(useUiStore.getState().pendingNav).toEqual({ mode: 'mission' })
  })

  it('holds a tab change too', () => {
    useUiStore.getState().setTab('failsafes')
    expect(useUiStore.getState().activeTab).toBe('overview')
    expect(useUiStore.getState().pendingNav).toEqual({ mode: 'setup', tab: 'failsafes' })
  })

  it('does not ask when the destination is where you already are', () => {
    // Clicking the current tab is not leaving the page, and a dialog for it
    // would be pure obstruction.
    useUiStore.getState().setTab('overview')
    expect(useUiStore.getState().pendingNav).toBeNull()
    useUiStore.getState().setMode('setup')
    expect(useUiStore.getState().pendingNav).toBeNull()
  })

  it('goes through on commit, and stays put on cancel', () => {
    useUiStore.getState().setTab('tuning')
    useUiStore.getState().commitPendingNav()
    expect(useUiStore.getState()).toMatchObject({ mode: 'setup', activeTab: 'tuning' })
    expect(useUiStore.getState().pendingNav).toBeNull()

    useUiStore.getState().setMode('fly')
    useUiStore.getState().cancelPendingNav()
    expect(useUiStore.getState().mode).toBe('setup')
    expect(useUiStore.getState().pendingNav).toBeNull()
  })

  it('lets navigation through again once the edits are gone', () => {
    useUiStore.getState().setMode('fly')
    expect(useUiStore.getState().pendingNav).not.toBeNull()
    useUiStore.getState().cancelPendingNav()

    useParamStore.getState().revertAll()
    useUiStore.getState().setMode('fly')
    expect(useUiStore.getState().mode).toBe('fly')
    expect(useUiStore.getState().pendingNav).toBeNull()
  })

  it('stops asking once the vehicle has confirmed the write', () => {
    // confirmWrite is what the echo handler calls; the edit is no longer
    // unwritten, so the page is no longer holding anything.
    useParamStore.getState().confirmWrite('ANGLE_MAX', 4500)
    expect(useParamStore.getState().dirtyCount).toBe(0)
    useUiStore.getState().setMode('mission')
    expect(useUiStore.getState().mode).toBe('mission')
  })
})
