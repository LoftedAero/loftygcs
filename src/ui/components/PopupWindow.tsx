import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// A real, separate window that can be dragged to another screen, drawn by
// this renderer into a blank document it opens. The content stays in the
// app's React tree, so it reads the same stores and updates live with no
// messaging between windows. Electron allows these by name only (main.ts's
// window-open handler); a browser opens a popup.

/** The window names main.ts allows; keep the two in step. */
const NAME_PREFIX = 'loftgcs-popup-'

/** Which mount owns each named window, so a remount reuses it (see cleanup). */
const owners = new Map<string, symbol>()

export default function PopupWindow({
  name,
  title,
  width,
  height,
  onClose,
  fallback,
  children,
}: {
  name: string
  title: string
  /** The window's opening size, in CSS pixels: fit to the content. */
  width: number
  height: number
  /** The user closed the window. */
  onClose: () => void
  /** Shown instead when the window could not be opened (a popup blocker). */
  fallback: ReactNode
  children: ReactNode
}) {
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const [blocked, setBlocked] = useState(false)
  const winRef = useRef<Window | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Once drawn, the window takes its content's height, so it opens with
  // neither a scroll bar nor an empty band. Measured rather than set, because
  // the content's height depends on the vehicle (a second IMU adds rows).
  //
  // Checked and asked again, because a resize that lands while the window is
  // first being shown can be undone: measured under Wayland, the compositor
  // then applies the opening size over it.
  useEffect(() => {
    const win = winRef.current
    if (!root || !win) return
    let timer = 0
    const fit = (triesLeft: number) => {
      const style = win.getComputedStyle(root)
      const content = root.firstElementChild?.getBoundingClientRect().height ?? 0
      const want = Math.ceil(
        content + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
      )
      if (want <= 0 || Math.abs(want - win.innerHeight) <= 1 || triesLeft === 0) return
      // The desktop app sizes it exactly; a browser's own resize is the fallback.
      if (window.loftgcs) window.loftgcs.app.fitPopup(NAME_PREFIX + name, want)
      else win.resizeBy(0, want - win.innerHeight)
      timer = window.setTimeout(() => fit(triesLeft - 1), 300)
    }
    const raf = win.requestAnimationFrame(() => fit(3))
    return () => {
      win.cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
  }, [root, name])

  useEffect(() => {
    const winName = NAME_PREFIX + name
    const token = Symbol(winName)
    owners.set(winName, token)
    // An existing window of this name is returned as it is, not reloaded.
    const win = window.open('', winName, `width=${width},height=${height}`)
    if (!win) {
      setBlocked(true)
      return
    }
    winRef.current = win
    const doc = win.document
    // The app's stylesheets, so its tokens and classes apply in the new
    // document; relative URLs resolve against the app, which created it.
    doc.head.replaceChildren(
      ...[...document.head.querySelectorAll('style, link[rel="stylesheet"]')].map((n) =>
        n.cloneNode(true),
      ),
    )
    // After the head is replaced, which would take a <title> with it.
    doc.title = title
    // The theme lives on the root element's attributes; follow it.
    const syncRoot = () => {
      for (const a of [...doc.documentElement.attributes]) {
        doc.documentElement.removeAttribute(a.name)
      }
      for (const a of [...document.documentElement.attributes]) {
        doc.documentElement.setAttribute(a.name, a.value)
      }
    }
    syncRoot()
    const themeWatch = new MutationObserver(syncRoot)
    themeWatch.observe(document.documentElement, { attributes: true })
    const container = doc.createElement('div')
    container.className = 'app-popup'
    doc.body.replaceChildren(container)
    setRoot(container)

    // Closed by the user. Polled as well as heard, since a window closed by
    // its own frame does not reliably fire pagehide.
    const closed = () => {
      if (owners.get(winName) === token) onCloseRef.current()
    }
    win.addEventListener('pagehide', closed)
    const poll = window.setInterval(() => win.closed && closed(), 500)
    const closeWithApp = () => win.close()
    window.addEventListener('beforeunload', closeWithApp)

    return () => {
      themeWatch.disconnect()
      win.removeEventListener('pagehide', closed)
      window.clearInterval(poll)
      window.removeEventListener('beforeunload', closeWithApp)
      // Deferred: a remount (React's development double mount) takes the
      // window over within the same tick, and closing it here would make it
      // flicker shut and open again.
      setTimeout(() => {
        if (owners.get(winName) === token) {
          owners.delete(winName)
          win.close()
        }
      }, 0)
    }
  }, [name, title, width, height])

  if (blocked) return <>{fallback}</>
  return root ? createPortal(children, root) : null
}
