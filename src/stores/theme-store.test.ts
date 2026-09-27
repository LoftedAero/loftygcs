// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveTheme, useThemeStore, watchSystemTheme } from './theme-store'

/** Stands in for matchMedia, whose listeners jsdom does not implement. */
function mockPrefersDark(dark: boolean) {
  const listeners = new Set<() => void>()
  const mql = {
    matches: dark,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  }
  vi.stubGlobal('matchMedia', () => mql)
  return {
    set(next: boolean) {
      mql.matches = next
      for (const cb of listeners) cb()
    },
    listenerCount: () => listeners.size,
  }
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.style.colorScheme = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolving a choice', () => {
  it('follows the machine when set to system', () => {
    mockPrefersDark(true)
    expect(resolveTheme('system')).toBe('dark')
    mockPrefersDark(false)
    expect(resolveTheme('system')).toBe('light')
  })

  it('ignores the machine once a choice is explicit', () => {
    mockPrefersDark(true)
    expect(resolveTheme('light')).toBe('light')
    mockPrefersDark(false)
    expect(resolveTheme('dark')).toBe('dark')
  })
})

describe('applying a choice', () => {
  it('stamps the document and sets color-scheme', () => {
    // color-scheme darkens scrollbars and select popups, which CSS cannot reach.
    mockPrefersDark(false)
    useThemeStore.getState().setChoice('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('remembers the choice, not the resolved value', () => {
    mockPrefersDark(true)
    useThemeStore.getState().setChoice('system')
    // Storing "dark" would stop following the OS.
    expect(localStorage.getItem('loftgcs.theme')).toBe('system')
    expect(useThemeStore.getState().resolved).toBe('dark')
  })

  it('toggles to an explicit opposite, even from system', () => {
    mockPrefersDark(true)
    useThemeStore.getState().setChoice('system')
    useThemeStore.getState().toggle()
    expect(useThemeStore.getState().choice).toBe('light')
    expect(useThemeStore.getState().resolved).toBe('light')
  })
})

describe('following the system', () => {
  it('changes with the OS while the choice is system', () => {
    const mq = mockPrefersDark(false)
    useThemeStore.getState().setChoice('system')
    const stop = watchSystemTheme()
    mq.set(true)
    expect(useThemeStore.getState().resolved).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    stop()
  })

  it('leaves an explicit choice alone when the OS changes', () => {
    const mq = mockPrefersDark(false)
    useThemeStore.getState().setChoice('light')
    const stop = watchSystemTheme()
    mq.set(true)
    expect(useThemeStore.getState().resolved).toBe('light')
    stop()
  })

  it('detaches its listener when stopped', () => {
    const mq = mockPrefersDark(false)
    const stop = watchSystemTheme()
    expect(mq.listenerCount()).toBe(1)
    stop()
    expect(mq.listenerCount()).toBe(0)
  })
})
