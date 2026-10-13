import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import PopupWindow from './PopupWindow'

// A pop-out is a second document this renderer draws into. jsdom cannot open
// a window, so window.open hands back a stand-in with a real document.

interface FakeWindow {
  document: Document
  closed: boolean
  innerHeight: number
  close: () => void
  addEventListener: Window['addEventListener']
  removeEventListener: Window['removeEventListener']
  requestAnimationFrame: (cb: FrameRequestCallback) => number
  cancelAnimationFrame: (id: number) => void
  getComputedStyle: Window['getComputedStyle']
  resizeBy: ReturnType<typeof vi.fn>
}

let popup: FakeWindow
let opened: unknown[][]

beforeEach(() => {
  opened = []
  const doc = document.implementation.createHTMLDocument('')
  popup = {
    document: doc,
    closed: false,
    innerHeight: 700,
    close() {
      this.closed = true
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: (cb) => window.setTimeout(() => cb(0), 0),
    cancelAnimationFrame: (id) => window.clearTimeout(id),
    getComputedStyle: (el) => window.getComputedStyle(el),
    resizeBy: vi.fn(),
  }
  vi.spyOn(window, 'open').mockImplementation((...args: unknown[]) => {
    opened.push(args)
    return popup as unknown as Window
  })
  const style = document.createElement('style')
  style.textContent = '.marker { color: red }'
  document.head.appendChild(style)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.head.querySelectorAll('style').forEach((s) => s.remove())
})

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)))

describe('PopupWindow', () => {
  it('opens a named window and draws its children into it, not into the app', () => {
    render(
      <PopupWindow
        name="test"
        title="Test window"
        width={900}
        height={700}
        onClose={() => {}}
        fallback={<p>fallback</p>}
      >
        <p>inside</p>
      </PopupWindow>,
    )
    expect(opened[0]?.[1]).toBe('loftgcs-popup-test')
    expect(opened[0]?.[2]).toBe('width=900,height=700')
    expect(popup.document.body.textContent).toBe('inside')
    expect(screen.queryByText('inside')).toBeNull()
  })

  it("carries the app's stylesheets, its theme, and its title", () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    render(
      <PopupWindow
        name="test"
        title="Test window"
        width={900}
        height={700}
        onClose={() => {}}
        fallback={null}
      >
        <p>inside</p>
      </PopupWindow>,
    )
    expect(popup.document.head.querySelector('style')?.textContent).toContain('.marker')
    expect(popup.document.title).toBe('Test window')
    expect(popup.document.documentElement.getAttribute('data-theme')).toBe('dark')
    document.documentElement.removeAttribute('data-theme')
  })

  it('shows the fallback when the window cannot be opened', () => {
    vi.mocked(window.open).mockReturnValue(null)
    render(
      <PopupWindow
        name="test"
        title="Test window"
        width={900}
        height={700}
        onClose={() => {}}
        fallback={<p>fallback</p>}
      >
        <p>inside</p>
      </PopupWindow>,
    )
    expect(screen.getByText('fallback')).toBeTruthy()
  })

  it('reports the window closed by the user', async () => {
    const onClose = vi.fn()
    render(
      <PopupWindow
        name="test"
        title="Test window"
        width={900}
        height={700}
        onClose={onClose}
        fallback={null}
      >
        <p>inside</p>
      </PopupWindow>,
    )
    popup.closed = true
    await wait(700)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes the window when it is no longer wanted', async () => {
    const { unmount } = render(
      <PopupWindow
        name="test"
        title="Test window"
        width={900}
        height={700}
        onClose={() => {}}
        fallback={null}
      >
        <p>inside</p>
      </PopupWindow>,
    )
    unmount()
    await wait(10)
    expect(popup.closed).toBe(true)
  })
})
