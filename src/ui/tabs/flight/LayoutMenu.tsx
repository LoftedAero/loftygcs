import { useEffect, useRef, useState } from 'react'
import { LaButton, LaSwitch } from '../../components/La'
import { useFlightLayoutStore } from '../../../stores/flight-layout-store'

// The view switches, behind one button. They were a strip of six toggles
// across the top of the screen, which put arranging the window at the same
// visual weight as flying the aircraft. They are set once and then left
// alone, so they belong behind a menu; the commands get the space.

export default function LayoutMenu() {
  const layout = useFlightLayoutStore()
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // Deferred a tick, or the click that opened the menu closes it again.
    const id = window.setTimeout(() => {
      window.addEventListener('pointerdown', away)
      window.addEventListener('keydown', esc)
    }, 0)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div className="layout-menu" ref={boxRef}>
      <LaButton
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        View ▾
      </LaButton>
      {open && (
        <div className="layout-menu__panel" role="menu">
          <p className="layout-menu__heading">Panels</p>
          <LaSwitch label="Map" checked={layout.showMap} onChange={() => layout.toggle('showMap')} />
          <LaSwitch label="HUD" checked={layout.showHud} onChange={() => layout.toggle('showHud')} />
          <LaSwitch
            label="Messages"
            checked={layout.showMessages}
            onChange={() => layout.toggle('showMessages')}
          />

          <p className="layout-menu__heading">HUD layers</p>
          <LaSwitch
            label="Horizon"
            checked={layout.hudHorizon}
            disabled={!layout.showHud}
            onChange={() => layout.toggle('hudHorizon')}
          />
          <LaSwitch
            label="Instruments"
            checked={layout.hudOverlays}
            disabled={!layout.showHud}
            onChange={() => layout.toggle('hudOverlays')}
          />

          <div className="layout-menu__actions">
            <LaButton variant="secondary" size="sm" onClick={layout.swap}>
              Swap panels
            </LaButton>
            <LaButton variant="ghost" size="sm" onClick={layout.reset}>
              Reset
            </LaButton>
          </div>
        </div>
      )}
    </div>
  )
}
