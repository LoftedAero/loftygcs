import { useMissionStore, type FenceTool } from '../../../stores/mission-store'

// The fence drawing tools, as a strip down the left edge of the map.
//
// Same strip, same classes and same behavior as the mission item palette:
// a button arms a tool and the next map click answers it, and clicking an
// armed button disarms it. They were a column of full-width text buttons
// before, which put the thing you draw with on the far side of the window
// from the thing you draw on, and made the fence screen look like a
// different app from the mission screen.
//
// Finishing an area belongs here for the same reason. It only appears while
// one is being drawn, and it counts the corners -- three is the minimum the
// vehicle will accept, and a two-corner "area" refused on upload is a much
// worse way to learn that.

const TOOLS: { id: FenceTool; label: string; title: string }[] = [
  { id: 'inclusionPolygon', label: 'Inclusion area', title: 'Keep the vehicle inside this' },
  { id: 'exclusionPolygon', label: 'Exclusion area', title: 'Keep the vehicle out of this' },
  { id: 'inclusionCircle', label: 'Inclusion circle', title: 'Keep the vehicle within a radius' },
  { id: 'exclusionCircle', label: 'Exclusion circle', title: 'Keep the vehicle clear by a radius' },
  { id: 'returnPoint', label: 'Return point', title: 'Where a breach sends the vehicle' },
]

const ICONS: Record<FenceTool, () => React.ReactElement> = {
  inclusionPolygon: InclusionAreaIcon,
  exclusionPolygon: ExclusionAreaIcon,
  inclusionCircle: InclusionCircleIcon,
  exclusionCircle: ExclusionCircleIcon,
  returnPoint: ReturnPointIcon,
}

export default function FencePalette() {
  const tool = useMissionStore((s) => s.fenceTool)
  const draft = useMissionStore((s) => s.fenceDraft)
  const setTool = useMissionStore((s) => s.setFenceTool)
  const finish = useMissionStore((s) => s.finishFenceShape)

  const drawing = tool === 'inclusionPolygon' || tool === 'exclusionPolygon'

  return (
    <div className="mission-palette" role="toolbar" aria-label="Draw a fence">
      {TOOLS.map((t) => {
        const Icon = ICONS[t.id]
        return (
          <button
            key={t.id}
            type="button"
            className={`mission-palette__btn${tool === t.id ? ' is-armed' : ''}`}
            aria-pressed={tool === t.id}
            title={t.title}
            onClick={() => setTool(tool === t.id ? null : t.id)}
          >
            <Icon />
            <span className="mission-palette__label">{t.label}</span>
          </button>
        )
      })}

      {drawing && (
        <button
          type="button"
          className="mission-palette__btn"
          disabled={draft.length < 3}
          title={
            draft.length < 3 ? 'An area needs at least three corners' : 'Close the area and keep it'
          }
          onClick={finish}
        >
          <FinishIcon />
          <span className="mission-palette__label">Finish ({draft.length})</span>
        </button>
      )}
    </div>
  )
}

// Line-art on the same 24-box as the item palette, stroked in currentColor
// so an armed button inverts them with itself.
const box = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none' } as const
const stroke = {
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

// Two readings, and both have to survive 22 pixels. Area against circle is
// the silhouette, so the polygon carries its corners: mitered rather than
// rounded, because rounded joins at this size turned the pentagon into a
// circle and made "exclusion area" and "exclusion circle" the same picture.
// Inclusion against exclusion is what is inside: the vehicle held in, or the
// boundary struck through.
const AREA = 'M12 3.5 20.5 9.7 17.2 19.8H6.8L3.5 9.7Z'
const corners = { ...stroke, strokeLinejoin: 'miter' } as const

function InclusionAreaIcon() {
  return (
    <svg {...box} aria-hidden="true">
      <path d={AREA} {...corners} />
      <circle cx="12" cy="12.5" r="1.8" fill="currentColor" />
    </svg>
  )
}

function ExclusionAreaIcon() {
  return (
    <svg {...box} aria-hidden="true">
      <path d={AREA} {...corners} />
      <path d="M7 17.5 17 7.5" {...stroke} />
    </svg>
  )
}

function InclusionCircleIcon() {
  return (
    <svg {...box} aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" {...stroke} />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
    </svg>
  )
}

function ExclusionCircleIcon() {
  return (
    <svg {...box} aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" {...stroke} />
      <path d="M6.7 17.3 17.3 6.7" {...stroke} />
    </svg>
  )
}

function ReturnPointIcon() {
  return (
    <svg {...box} aria-hidden="true">
      <path d="M7 20V4" {...stroke} />
      <path d="M7 5h10l-2.5 3.5L17 12H7" {...stroke} />
    </svg>
  )
}

function FinishIcon() {
  return (
    <svg {...box} aria-hidden="true">
      <path d="M4.5 12.5 10 18 19.5 6.5" {...stroke} />
    </svg>
  )
}
