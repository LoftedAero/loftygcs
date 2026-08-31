import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  MISSION_COMMANDS,
  commandSpec,
} from '../../../protocol/mission-commands'
import { useMissionStore } from '../../../stores/mission-store'

// The add-an-item palette: a vertical strip down the left edge of the map,
// the way QGroundControl arranges it.
//
// Vertical because the map is wider than it is tall and a horizontal bar
// across the top steals the band of map most likely to hold the mission.
// Icons above labels rather than text buttons, so the strip stays narrow
// enough to sit over the map without being in the way.
//
// A button arms a tool rather than adding immediately: a located item needs
// a position, and the honest way to ask for one is to let the next map click
// be the answer. Clicking an armed button disarms it. Everything the strip
// does not show is behind "More", which is Mission Planner's model -- add a
// generic item and choose its command from the row's dropdown.

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

export default function ItemPalette({ tool, onTool }: ItemPaletteProps) {
  const addItem = useMissionStore((s) => s.addItem)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)

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

  const entries: Entry[] = [
    { id: 22, label: 'Takeoff', icon: <TakeoffIcon /> },
    { id: 16, label: 'Waypoint', icon: <WaypointIcon /> },
    { id: 201, label: 'ROI', icon: <RoiIcon /> },
    { id: 21, label: 'Land', icon: <LandIcon /> },
    { id: 20, label: 'Return', icon: <ReturnIcon /> },
  ]

  const pick = (id: number) => {
    const spec = commandSpec(id)
    // Commands with no position have nothing to click for, so they are
    // appended the moment they are chosen rather than arming a tool that
    // would wait for a click that means nothing.
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
        className={`mission-palette__btn${tool === HOME_TOOL ? ' is-armed' : ''}`}
        aria-pressed={tool === HOME_TOOL}
        title="Place the planned home position"
        onClick={() => onTool(tool === HOME_TOOL ? null : HOME_TOOL)}
      >
        <HomeIcon />
        <span className="mission-palette__label">Home</span>
      </button>

      <div className="mission-palette__more" ref={moreRef}>
        <button
          type="button"
          className="mission-palette__btn"
          aria-expanded={moreOpen}
          aria-haspopup="menu"
          title="Every other mission command"
          onClick={() => setMoreOpen((v) => !v)}
        >
          <MoreIcon />
          <span className="mission-palette__label">More</span>
        </button>
        {moreOpen && (
          <div className="mission-palette__menu" role="menu">
            {(['nav', 'condition', 'do'] as const).map((cat) => (
              <div key={cat} className="mission-palette__group">
                <p className="mission-palette__groupname">{CATEGORY[cat]}</p>
                {MISSION_COMMANDS.filter((c) => c.category === cat).map((c) => (
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
                    {/* ArduPilot's own command names here, not our friendlier
                        ones: anyone reaching past the five common items is
                        working from the ArduPilot mission docs or a Mission
                        Planner habit, and a translation only makes them guess
                        which of ours is the one they read about. The plain
                        name still shows on hover and in the table. */}
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

const CATEGORY = {
  nav: 'Navigation — the vehicle moves',
  condition: 'Conditions — wait for something',
  do: 'Actions — run and continue',
} as const

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

function MoreIcon() {
  return (
    <svg {...box} aria-hidden="true">
      <circle cx="6" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="18" cy="12" r="1.6" fill="currentColor" />
    </svg>
  )
}
