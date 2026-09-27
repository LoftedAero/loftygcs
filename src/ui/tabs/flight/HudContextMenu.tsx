import { useEffect, useRef } from 'react'
import { useMenuPlacement } from '../../components/menu-placement'
import { LaButton, LaSwitch } from '../../components/La'
import { useFlightLayoutStore } from '../../../stores/flight-layout-store'

// Right-click on the HUD: toggles for what is drawn on it and behind it.
// These duplicate the View menu so they can be reached from the HUD itself.

export interface HudMenuPoint {
  x: number
  y: number
}

export interface HudContextMenuProps {
  point: HudMenuPoint
  onClose: () => void
  /** Opens the video source dialog. */
  onVideo: () => void
}

export default function HudContextMenu({ point, onClose, onVideo }: HudContextMenuProps) {
  const layout = useFlightLayoutStore()
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Deferred a tick, or the gesture that opened it closes it again.
    const id = window.setTimeout(() => {
      window.addEventListener('pointerdown', away)
      window.addEventListener('keydown', esc)
    }, 0)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [onClose])

  // Kept on screen when the click lands near an edge, by its own size.
  const style = useMenuPlacement(point, boxRef)

  return (
    <div className="context-menu hud-menu" style={style} ref={boxRef} role="menu">
      <p className="context-menu__heading">HUD layers</p>
      <LaSwitch
        label="Horizon"
        checked={layout.hudHorizon}
        onChange={() => layout.toggle('hudHorizon')}
      />
      <LaSwitch
        label="Instruments"
        checked={layout.hudOverlays}
        onChange={() => layout.toggle('hudOverlays')}
      />

      <div className="context-menu__actions">
        <LaButton
          variant="secondary"
          size="block"
          onClick={() => {
            onClose()
            onVideo()
          }}
        >
          HUD video
        </LaButton>
      </div>
    </div>
  )
}
