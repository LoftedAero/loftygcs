import { useEffect, useRef, useState, type ReactElement } from 'react'
import { MISSION_COMMANDS, commandSpec } from '../../../protocol/mission-commands'
import { useMissionStore } from '../../../stores/mission-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { homeFromVehicle } from '../../../services/mission'

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

/** Its `max-height`, for deciding where the top edge goes. */
const MENU_MAX_H = 320

export default function ItemPalette({ tool, onTool }: ItemPaletteProps) {
  const addItem = useMissionStore((s) => s.addItem)
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const startSurvey = useMissionStore((s) => s.startSurvey)
  const cancelSurvey = useMissionStore((s) => s.cancelSurvey)
  const surveying = useMissionStore((s) => s.survey !== null)
  const [moreOpen, setMoreOpen] = useState(false)
  // Where the flyout goes, in viewport coordinates. It has to be `fixed`:
  // the palette is a scroll box (it must never outgrow a map dragged short)
  // and an absolutely positioned child of a scroll box is clipped to it --
  // which is exactly what happened here. The menu was in the DOM, twenty-one
  // items and all, and none of it was on screen.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // Home's alternative, offered while its tool is armed rather than as a
  // button of its own -- see below.
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
   * Beside the button, and inside the window.
   *
   * Anchored to the button's bottom so it grows upward like the palette it
   * belongs to, then pushed down if that would take it off the top -- which
   * it would whenever the map has been dragged short.
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

      {/* Home arms placement like every other tool, and while it is armed a
          second tile appears beside it with the other way of answering the
          same question. A permanent row of its own said the two were separate
          jobs and cost the strip a row for the rarer of them; it still cannot
          live on the home marker, because the whole point is reaching it
          before a home exists. The tile is the palette's own chrome so it
          reads as the strip growing an option, not as a menu opening. */}
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
                ? "Put home at the vehicle's position instead of clicking the map"
                : 'Connect a vehicle to copy its position'
            }
            onClick={() => {
              onTool(null)
              homeFromVehicle()
            }}
          >
            <FromVehicleIcon />
            {/* One word, so the tile is exactly a palette button's box --
                "From vehicle" wrapped to two lines and made it taller than
                everything it sits beside. The sentence is on the title. */}
            <span className="mission-palette__label">Vehicle</span>
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
            {/* Grouped but unlabeled: the categories order the list, and
                naming each one spent three lines apiece saying what the
                commands underneath already say. */}
            {(['nav', 'condition', 'do'] as const).map((cat) => (
              <div key={cat} className="mission-palette__group">
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

// A home under a fix: the Home tool's own roof, with the satellite ticks
// that say where the position came from -- so the pair reads as two ways to
// answer one question rather than as two different things.
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
