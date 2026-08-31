import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import App from './App'
import { MODES, TABS, useUiStore } from './stores/ui-store'

// Testing Library only auto-cleans between tests when the runner exposes
// globals; we keep globals off, so unmount explicitly.
afterEach(cleanup)
beforeEach(() => useUiStore.setState({ mode: 'setup', activeTab: 'overview' }))

describe('app shell', () => {
  it('renders every setup section in the rail and switches between them', () => {
    render(<App />)
    for (const tab of TABS) {
      expect(screen.getByRole('button', { name: tab.label })).toBeTruthy()
    }
    expect(screen.getByText('Ground control for ArduPilot')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Parameters' }))
    expect(screen.getByText(/Connect a vehicle to load its parameters/)).toBeTruthy()
  })

  it('switches top-level modes and hides the rail outside Setup', () => {
    render(<App />)
    for (const mode of MODES) {
      expect(screen.getByRole('tab', { name: mode.label })).toBeTruthy()
    }
    // Fly and Mission are full-window: no setup rail alongside them.
    fireEvent.click(screen.getByRole('tab', { name: 'Fly' }))
    expect(screen.queryByRole('button', { name: 'Firmware' })).toBeNull()
    expect(screen.getByText(/Connect a vehicle \(or start demo mode\) to fly/)).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Mission' }))
    // The planner stands on its own without a vehicle: a mission can be
    // built and saved to a file before anything is connected.
    // The actions column's heading, not one of its buttons: this is asserting
    // that the planner mounted, and it has now broken twice on button wording
    // that was being tuned for entirely unrelated reasons.
    expect(screen.getByRole('heading', { name: 'Mission' })).toBeTruthy()
    expect(screen.getByText(/No items yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Firmware' })).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    expect(screen.getByRole('button', { name: 'Firmware' })).toBeTruthy()
  })

  it('marks the active mode and tab for assistive tech', () => {
    render(<App />)
    expect(screen.getByRole('tab', { name: 'Setup' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Fly' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('keeps Connect as the single primary action in the app bar', () => {
    render(<App />)
    // The mode switch must not compete with Connect for the orange.
    const connect = screen.getByRole('button', { name: 'Connect' })
    expect(connect.className).toContain('la-btn--primary')
    for (const mode of MODES) {
      expect(screen.getByRole('tab', { name: mode.label }).className).not.toContain('la-btn')
    }
  })
})
