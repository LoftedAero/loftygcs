import { useEffect, useRef, useState } from 'react'
import { LaButton, LaSwitch } from '../../components/La'
import { useFlightLayoutStore } from '../../../stores/flight-layout-store'

// The view switches, behind one button. They were a strip of six toggles
// across the top of the screen, which put arranging the window at the same
// visual weight as flying the aircraft. They are set once and then left
// alone, so they belong behind a menu; the commands get the space.

/** Roughly how tall the panel is, for deciding which way it opens. */
const PANEL_H = 300

export interface LayoutMenuProps {
  /** Opens the video source dialog; it lives outside this menu. */
  onVideo: () => void
}

export default function LayoutMenu({ onVideo }: LayoutMenuProps) {
  const layout = useFlightLayoutStore()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
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

  // Placed against the viewport rather than anchored above the button.
  // Anchored, it opened upward and went off the top of the window whenever
  // the controls sat at the top of the column -- which is exactly what
  // happens with the HUD switched off.
  const place = () => {
    // The wrapper is just the button until the panel opens, so its box is
    // the button box.
    const r = boxRef.current?.getBoundingClientRect()
    if (!r) return
    const above = r.top - 8 - PANEL_H
    setPos({
      left: Math.max(8, Math.min(r.right - 210, window.innerWidth - 218)),
      top: above >= 8 ? above : Math.min(r.bottom + 8, window.innerHeight - PANEL_H - 8),
    })
  }

  return (
    <div className="layout-menu" ref={boxRef}>
      <LaButton
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          if (!open) place()
          setOpen((o) => !o)
        }}
      >
        View ▾
      </LaButton>
      {open && pos && (
        <div className="layout-menu__panel" role="menu" style={{ left: pos.left, top: pos.top }}>
          <p className="layout-menu__heading">Panels</p>
          <LaSwitch
            label="Map"
            checked={layout.showMap}
            onChange={() => layout.toggle('showMap')}
          />
          <LaSwitch
            label="HUD"
            checked={layout.showHud}
            onChange={() => layout.toggle('showHud')}
          />
          <LaSwitch
            label="Messages"
            checked={layout.showMessages}
            onChange={() => layout.toggle('showMessages')}
          />
          <LaSwitch
            label="Plot"
            checked={layout.showPlot}
            onChange={() => layout.toggle('showPlot')}
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
          <div className="layout-menu__actions">
            <LaButton
              variant="secondary"
              size="sm"
              onClick={() => {
                setOpen(false)
                onVideo()
              }}
            >
              HUD video…
            </LaButton>
          </div>
        </div>
      )}
    </div>
  )
}
