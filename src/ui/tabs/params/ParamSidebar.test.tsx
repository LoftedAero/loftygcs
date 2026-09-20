import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import ParamSidebar from './ParamSidebar'
import { useParamLogStore } from '../../../stores/param-log-store'

// Only the change log at the foot of the column -- the rest of this column
// (Write/Revert/Reload, the file buttons) is exercised elsewhere.

beforeEach(() => useParamLogStore.getState().reset())
afterEach(cleanup)

it('says there is nothing yet before any change is staged', () => {
  render(<ParamSidebar />)
  expect(screen.getByText(/will appear here/i)).toBeTruthy()
})

it('shows a pending line in the warning color', () => {
  useParamLogStore.getState().recordEdit('MOT_SPIN_MIN', 0.1, 0.2)
  render(<ParamSidebar />)
  const line = screen.getByText(/MOT_SPIN_MIN update from 0\.1 to 0\.2: pending/)
  expect(line.className).toContain('is-pending')
})

it('drops the pending color once the write commits', () => {
  const log = useParamLogStore.getState()
  log.recordEdit('MOT_SPIN_MIN', 0.1, 0.2)
  log.recordCommit('MOT_SPIN_MIN', 0.2)
  render(<ParamSidebar />)
  const line = screen.getByText(/MOT_SPIN_MIN update from 0\.1 to 0\.2: committed/)
  expect(line.className).not.toContain('is-pending')
})
