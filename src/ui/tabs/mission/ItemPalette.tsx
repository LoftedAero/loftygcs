import { useEffect, useRef, useState, type ReactElement } from 'react'
import { commandSpec, commandsFor } from '../../../protocol/mission-commands'
import { usePlanVehicleClass } from './plan-vehicle'
import { useMissionStore } from '../../../stores/mission-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { homeFromVehicle } from '../../../services/mission'

// The add-an-item palette: a narrow vertical strip down the left edge of the
// map, as in QGroundControl.
//
// A button arms a tool and the next map click places the item; clicking an
// armed button disarms it. Other commands are behind "More".

/** The command a plain map click places when nothing is armed. */
export const DEFAULT_TOOL = 16

/** Sentinel for the home marker, which is not a mission command. */
export const HOME_TOOL = -1

export interface ItemPaletteProps {
  tool: number | null
  onTool: (command: number | null) => void
}

interface Entry {
  id: number
  label: string
  icon: ReactElement
}

/** Its `max-height`, for deciding where the top edge goes. */
const MENU_MAX_H = 320

export default function ItemPalette({ tool, onTool }: ItemPaletteProps) {
  const addItem = useMissionStore((s) => s.addItem)
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const startSurvey = useMissionStore((s) => s.startSurvey)
  const cancelSurvey = useMissionStore((s) => s.cancelSurvey)
  const surveying = useMissionStore((s) => s.survey !== null)
  const [moreOpen, setMoreOpen] = useState(false)
  // Only the commands this aircraft accepts; with nothing connected, the
  // chosen plan-for class decides.
  const commands = commandsFor(usePlanVehicleClass())
  // The flyout's viewport position. It must be `fixed`: the palette is a
  // scroll box, and an absolutely positioned child would be clipped to it.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // The "at vehicle" flyout shown while the Home tool is armed.
  const [homePos, setHomePos] = useState<{ left: number; top: number } | null>(null)
  const homeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!moreOpen) return
    const away = (e: PointerEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    const id = window.setTimeout(() => {
      window.addEventListener('pointerdown', away)
      window.addEventListener('keydown', esc)
    }, 0)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [moreOpen])

  /**
   * Places the menu beside the button, anchored to its bottom so it grows
   * upward, and pushed down if that would leave the window.
   */
  const place = () => {
    const r = buttonRef.current?.getBoundingClientRect()
    if (!r) return
    const top = Math.min(
      Math.max(8, r.bottom - MENU_MAX_H),
      Math.max(8, window.innerHeight - MENU_MAX_H - 8),
    )
    setPos({ left: r.right + 8, top })
  }

  const entries: Entry[] = [
    { id: 22, label: 'Takeoff', icon: <TakeoffIcon /> },
    { id: 16, label: 'Waypoint', icon: <WaypointIcon /> },
    { id: 201, label: 'ROI', icon: <RoiIcon /> },
    { id: 21, label: 'Land', icon: <LandIcon /> },
    { id: 20, label: 'Return', icon: <ReturnIcon /> },
  ]

  const pick = (id: number) => {
    const spec = commandSpec(id)
    // Commands with no position are appended immediately.
    if (spec && !spec.location) {
      addItem(id)
      onTool(null)
    } else {
      onTool(tool === id ? null : id)
    }
  }

  return (
    <div className="mission-palette" role="toolbar" aria-label="Add mission item">
      {entries.map((e) => (
        <button
          key={e.id}
          type="button"
          className={`mission-palette__btn${tool === e.id ? ' is-armed' : ''}`}
          aria-pressed={tool === e.id}
          title={commandSpec(e.id)?.summary}
          onClick={() => pick(e.id)}
        >
          {e.icon}
          <span className="mission-palette__label">{e.label}</span>
        </button>
      ))}

      <button
        type="button"
        className={`mission-palette__btn${surveying ? ' is-armed' : ''}`}
        aria-pressed={surveying}
        title="Cover an area with a lawnmower pattern"
        onClick={() => {
          onTool(null)
          if (surveying) cancelSurvey()
          else startSurvey()
        }}
      >
        <SurveyIcon />
        <span className="mission-palette__label">Survey</span>
      </button>

      {/* Home arms placement like any tool; while armed, a second tile offers
          the vehicle's position instead. It lives here rather than on the home
          marker because it is needed before a home exists. */}
      <button
        ref={homeRef}
        type="button"
        className={`mission-palette__btn${tool === HOME_TOOL ? ' is-armed' : ''}`}
        aria-pressed={tool === HOME_TOOL}
        aria-haspopup="menu"
        title="Place the planned home position"
        onClick={() => {
          const armed = tool === HOME_TOOL
          if (!armed) {
            const r = homeRef.current?.getBoundingClientRect()
            if (r) setHomePos({ left: r.right + 8, top: r.top })
          }
          onTool(armed ? null : HOME_TOOL)
        }}
      >
        <HomeIcon />
        <span className="mission-palette__label">Home</span>
      </button>
      {tool === HOME_TOOL && homePos && (
        <div className="mission-palette mission-palette--flyout" role="menu" style={homePos}>
          <button
            type="button"
            role="menuitem"
            className="mission-palette__btn"
            disabled={!connected}
            title={
              connected
                ? "Set home at the vehicle's position"
                : 'Connect a vehicle to copy its position'
            }
            onClick={() => {
              onTool(null)
              homeFromVehicle()
            }}
          >
            <FromVehicleIcon />
            {/* Kept short enough to fit on one line in a palette button. */}
            <span className="mission-palette__label">At vehicle</span>
          </button>
        </div>
      )}

      <div className="mission-palette__more" ref={moreRef}>
        <button
          ref={buttonRef}
          type="button"
          className="mission-palette__btn"
          aria-expanded={moreOpen}
          aria-haspopup="menu"
          title="Every other mission command"
          onClick={() => {
            if (!moreOpen) place()
            setMoreOpen((v) => !v)
          }}
        >
          <MoreIcon />
          <span className="mission-palette__label">More</span>
        </button>
        {moreOpen && pos && (
          <div
            className="mission-palette__menu"
            role="menu"
            style={{ left: pos.left, top: pos.top }}
          >
            {/* Grouped by category, without headings. */}
            {(['nav', 'condition', 'do'] as const).map((cat) => (
              <div key={cat} className="mission-palette__group">
                {commands
                  .filter((c) => c.category === cat)
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="menuitem"
                      className="mission-palette__item"
                      title={`${c.name} — ${c.summary}`}
                      onClick={() => {
                        setMoreOpen(false)
                        pick(c.id)
                      }}
                    >
                      {/* ArduPilot's command names, matching its mission docs;
                        the friendly name shows on hover and in the table. */}
                      {c.mavName}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Line-art at a common 24-box, stroked in currentColor so the armed state
// inverts them along with the button.
const box = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none' } as const
const stroke = {
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

function TakeoffIcon() {
  return (
    <svg {...box} aria-hidden="true">
      <path d="M12 16V5M12 5 8.5 8.5M12 5l3.5 3.5" {...stroke} />
      <path d="M4 19h16" {...stroke} />
    </svg>
  )
}

function LandIcon() {
  return (
    <svg {...box} aria-hidden="true">
      <path d="M12 5v11M12 16l-3.5-3.5M12 16l3.5-3.5" {...stroke} />
      <path d="M4 19h16" {...stroke} />
    </svg>
  )
}

function WaypointIcon() {
  return (
    <svg {...box} aria-hidden="true">
      <path d="M12 21s6-6.2 6-10.2A6 6 0 0 0 6 10.8C6 14.8 12 21 12 21Z" {...stroke} />
      <circle cx="12" cy="10.5" r="2.2" {...stroke} />
    </svg>
  )
}

function RoiIcon() {
  return (
    <svg {...box} aria-hidden="true">
      <circle cx="12" cy="12" r="6.5" {...stroke} />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" {...stroke} />
    </svg>
  )
}

function ReturnIcon() {
  return (
    <svg {...box} aria-hidden="true">
      <path d="M9 7H15a4 4 0 0 1 0 8H7" {...stroke} />
      <path d="M10 4 7 7l3 3" {...stroke} />
    </svg>
  )
}

function HomeIcon() {
  return (
    <svg {...box} aria-hidden="true">
      <path d="M4 11 12 4l8 7" {...stroke} />
      <path d="M6.5 9.5V19h11V9.5" {...stroke} />
    </svg>
  )
}

function SurveyIcon() {
  return (
    <svg {...box} aria-hidden="true">
      <path d="M4 5h16v14H4z" {...stroke} />
      <path d="M7 5v14M12 5v14M17 5v14" {...stroke} strokeDasharray="2 3" />
    </svg>
  )
}

// The Home tool's roof with position-fix ticks above it.
function FromVehicleIcon() {
  return (
    <svg {...box} aria-hidden="true">
      <path d="M4 13.5 12 7l8 6.5" {...stroke} />
      <path d="M6.5 12.5V20h11v-7.5" {...stroke} />
      <circle cx="12" cy="16" r="1.6" fill="currentColor" />
      <path d="M12 2v2.5M8.6 3.2l1 2.1M15.4 3.2l-1 2.1" {...stroke} />
    </svg>
  )
}

function MoreIcon() {
  return (
    <svg {...box} aria-hidden="true">
      <circle cx="6" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="18" cy="12" r="1.6" fill="currentColor" />
    </svg>
  )
}
