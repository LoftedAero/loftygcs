import { useEffect } from 'react'
import { LaButton } from '../../components/La'
import FlightControls from './FlightControls'
import StatusList from './StatusList'
import CameraPanel from './CameraPanel'
import JoystickPanel from './JoystickPanel'
import VideoPane from './VideoPane'
import ViewPane from './ViewPane'

// Compact Fly's More sheet. It covers the Fly area but not the app bar, so the
// readings stay in view, and shows one section at a time. Messages and
// preflight are not here: the app bar's items open them.

export const SHEET_SECTIONS = [
  { id: 'controls', label: 'Controls' },
  { id: 'camera', label: 'Camera' },
  { id: 'video', label: 'Video' },
  { id: 'joystick', label: 'Joystick' },
  { id: 'status', label: 'Status' },
  { id: 'display', label: 'Display' },
] as const

export type SheetSection = (typeof SHEET_SECTIONS)[number]['id']

export default function FlightSheet({
  section,
  onSection,
  onClose,
}: {
  section: SheetSection
  onSection: (s: SheetSection) => void
  onClose: () => void
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  return (
    <div className="flight-sheet" role="dialog" aria-label="Flight">
      <div className="flight-sheet__head">
        <div className="flight-sheet__tabs" role="tablist" aria-label="Flight">
          {SHEET_SECTIONS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={section === t.id}
              className={`log-pane__tab${section === t.id ? ' is-active' : ''}`}
              onClick={() => onSection(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <LaButton variant="ghost" onClick={onClose}>
          Done
        </LaButton>
      </div>
      <div className={`flight-sheet__body flight-sheet__body--${section}`}>
        {section === 'controls' && <FlightControls part="secondary" compact />}
        {section === 'camera' && <CameraPanel />}
        {section === 'video' && <VideoPane />}
        {section === 'joystick' && <JoystickPanel />}
        {section === 'status' && <StatusList />}
        {section === 'display' && <ViewPane compact />}
      </div>
    </div>
  )
}
