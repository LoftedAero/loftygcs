import { useEffect, useRef, useState } from 'react'
import { useMenuPlacement } from '../../components/menu-placement'
import { LaButton, LaHint } from '../../components/La'
import { useVehicleStore } from '../../../stores/vehicle-store'

// The map's right-click menu, for actions tied to the clicked point: fly
// there, aim the camera there, move home there. The guided altitude is set
// inline on "Fly here".

export interface MapMenuPoint {
  lat: number
  lon: number
  x: number
  y: number
}

export interface MapContextMenuProps {
  point: MapMenuPoint
  onClose: () => void
  onFlyHere: (altRelM: number) => void
  onPointCamera: () => void
  onSetHome: () => void
}

export default function MapContextMenu({
  point,
  onClose,
  onFlyHere,
  onPointCamera,
  onSetHome,
}: MapContextMenuProps) {
  const modeName = useVehicleStore((s) => s.modeName)
  const armed = useVehicleStore((s) => s.armed)
  const relAltM = useVehicleStore((s) => s.relAltM)
  const boxRef = useRef<HTMLDivElement>(null)
  const [alt, setAlt] = useState(() => Math.max(Math.round(relAltM), 5))

  // Dismiss on any click outside the menu.
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Deferred a tick: the pointerup that opened the menu would otherwise
    // close it again immediately.
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

  const guided = modeName === 'Guided'

  return (
    <div className="context-menu map-menu" style={style} ref={boxRef} role="menu">
      <p className="map-menu__coords">
        {point.lat.toFixed(6)}, {point.lon.toFixed(6)}
      </p>

      <div className="map-menu__row">
        <label className="la-field__label" htmlFor="map-menu-alt">
          Altitude <span className="la-field__unit">m rel</span>
        </label>
        <input
          id="map-menu-alt"
          className="la-input la-input--num map-menu__alt"
          type="number"
          min={1}
          max={2000}
          value={alt}
          onChange={(e) => setAlt(Number(e.target.value))}
        />
      </div>

      <LaButton
        variant="primary"
        size="block"
        disabled={!guided || !armed}
        onClick={() => {
          onFlyHere(alt)
          onClose()
        }}
      >
        Fly here
      </LaButton>

      <LaButton
        variant="secondary"
        size="block"
        onClick={() => {
          onPointCamera()
          onClose()
        }}
      >
        Point camera here
      </LaButton>

      <LaButton
        variant="secondary"
        size="block"
        onClick={() => {
          onSetHome()
          onClose()
        }}
      >
        Set home here
      </LaButton>

      {guided && !armed && <LaHint>The vehicle is not armed.</LaHint>}
    </div>
  )
}
