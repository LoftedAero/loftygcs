import { beforeEach, describe, expect, it } from 'vitest'
import { useParamLogStore } from './param-log-store'

describe('param-log-store', () => {
  beforeEach(() => {
    useParamLogStore.getState().reset()
  })

  it('opens a pending line the first time a param is staged', () => {
    useParamLogStore.getState().recordEdit('MOT_SPIN_MIN', 0.1, 0.15)
    const { lines } = useParamLogStore.getState()
    expect(lines).toEqual([
      expect.objectContaining({
        param: 'MOT_SPIN_MIN',
        from: 0.1,
        to: 0.15,
        status: 'pending',
      }),
    ])
  })

  it('updates the same line rather than opening a new one on repeated edits', () => {
    const log = useParamLogStore.getState()
    log.recordEdit('MOT_SPIN_MIN', 0.1, 0.15)
    log.recordEdit('MOT_SPIN_MIN', 0.1, 0.2)
    log.recordEdit('MOT_SPIN_MIN', 0.1, 0.25)
    const { lines } = useParamLogStore.getState()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ from: 0.1, to: 0.25, status: 'pending' })
  })

  it('withdraws the line when an edit is typed back to its own value', () => {
    const log = useParamLogStore.getState()
    log.recordEdit('MOT_SPIN_MIN', 0.1, 0.2)
    log.recordEdit('MOT_SPIN_MIN', 0.1, 0.1)
    expect(useParamLogStore.getState().lines).toEqual([])
  })

  it('does nothing when a param that was never edited returns to its own value', () => {
    useParamLogStore.getState().recordEdit('MOT_SPIN_MIN', 0.1, 0.1)
    expect(useParamLogStore.getState().lines).toEqual([])
  })

  it('marks the line committed on a successful write, keeping the echoed value', () => {
    const log = useParamLogStore.getState()
    log.recordEdit('MOT_SPIN_MIN', 0.1, 0.15)
    log.recordCommit('MOT_SPIN_MIN', 0.15)
    const { lines } = useParamLogStore.getState()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ from: 0.1, to: 0.15, status: 'committed' })
  })

  it('starts a fresh pending line for a param edited again after it committed', () => {
    const log = useParamLogStore.getState()
    log.recordEdit('MOT_SPIN_MIN', 0.1, 0.15)
    log.recordCommit('MOT_SPIN_MIN', 0.15)
    log.recordEdit('MOT_SPIN_MIN', 0.15, 0.2)
    const { lines } = useParamLogStore.getState()
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ from: 0.1, to: 0.15, status: 'committed' })
    expect(lines[1]).toMatchObject({ from: 0.15, to: 0.2, status: 'pending' })
  })

  it('cancel withdraws a still-open line the way Revert does', () => {
    const log = useParamLogStore.getState()
    log.recordEdit('MOT_SPIN_MIN', 0.1, 0.2)
    log.cancel('MOT_SPIN_MIN')
    expect(useParamLogStore.getState().lines).toEqual([])
  })

  it('cancel on a param with no open line is a no-op', () => {
    useParamLogStore.getState().cancel('MOT_SPIN_MIN')
    expect(useParamLogStore.getState().lines).toEqual([])
  })

  it('recordCommit on a param with no open line does nothing', () => {
    useParamLogStore.getState().recordCommit('MOT_SPIN_MIN', 0.15)
    expect(useParamLogStore.getState().lines).toEqual([])
  })

  it('keeps separate lines for separate parameters', () => {
    const log = useParamLogStore.getState()
    log.recordEdit('MOT_SPIN_MIN', 0.1, 0.15)
    log.recordEdit('MOT_SPIN_MAX', 0.95, 0.9)
    expect(useParamLogStore.getState().lines).toHaveLength(2)
  })

  it('reset clears both the lines and the open bookkeeping', () => {
    const log = useParamLogStore.getState()
    log.recordEdit('MOT_SPIN_MIN', 0.1, 0.15)
    log.reset()
    expect(useParamLogStore.getState().lines).toEqual([])
    // A "reopened" edit after reset must start a new line, not silently
    // reattach to bookkeeping that reset was supposed to have cleared.
    log.recordEdit('MOT_SPIN_MIN', 0.15, 0.2)
    expect(useParamLogStore.getState().lines).toHaveLength(1)
  })
})
