import FlightControls from './FlightControls'
import StatusList from './StatusList'
import CameraPanel from './CameraPanel'
import JoystickPanel from './JoystickPanel'
import VideoPane from './VideoPane'
import ViewPane from './ViewPane'

// Compact Fly's sheet: what the desktop's controls and lower pane hold that
// the full-screen view has no room for, one section at a time, in a sheet
// rising from the bottom (BottomSheet). Messages and preflight are not here:
// the app bar's items open them.

const SECTIONS = [
  { id: 'controls', label: 'Controls' },
  { id: 'camera', label: 'Camera' },
  { id: 'video', label: 'Video' },
  { id: 'joystick', label: 'Joystick' },
  { id: 'status', label: 'Status' },
  { id: 'view', label: 'View' },
] as const

export type SheetSection = (typeof SECTIONS)[number]['id']

/** The handle's accessible name: the section it opens on. */
export function sectionLabel(s: SheetSection): string {
  return SECTIONS.find((t) => t.id === s)?.label ?? ''
}

export default function FlightSheet({
  section,
  onSection,
}: {
  section: SheetSection
  onSection: (s: SheetSection) => void
}) {
  return (
    <div className="flight-sheet">
      <div className="flight-sheet__tabs" role="tablist" aria-label="Flight sheet">
        {SECTIONS.map((t) => (
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
      <div className={`flight-sheet__body flight-sheet__body--${section}`} role="tabpanel">
        {section === 'controls' && <FlightControls part="secondary" compact />}
        {section === 'camera' && <CameraPanel />}
        {section === 'video' && <VideoPane />}
        {section === 'joystick' && <JoystickPanel />}
        {section === 'status' && <StatusList />}
        {section === 'view' && <ViewPane compact />}
      </div>
    </div>
  )
}
