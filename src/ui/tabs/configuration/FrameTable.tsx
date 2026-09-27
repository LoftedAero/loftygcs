import FrameDiagram from './FrameDiagram'
import { FRAME_CLASS_NAMES, frameTiles } from '../../../protocol/frame-layout'
import { useParamStore } from '../../../stores/param-store'

// A frame class picker made of the frame pictures, with the chosen one marked.
//
// The set is the same for every frame type and no tile is blank (see
// frameTiles). A class that does not take the chosen type is drawn in its
// canonical shape and dimmed.
//
// The selection is blue, not orange: orange on this screen is for staged
// edits and Write.
export default function FrameTable({
  frameClass,
  frameType,
  onPick,
}: {
  frameClass: number | undefined
  frameType: number
  onPick: (frameClass: number) => void
}) {
  const names = useParamStore((s) => s.metadata['FRAME_CLASS']?.values)
  const typeNames = useParamStore((s) => s.metadata['FRAME_TYPE']?.values)
  const tiles = frameTiles(frameType)
  if (tiles.length === 0) return null
  const typeName = typeNames?.[frameType] ?? `type ${frameType}`

  return (
    <div className="frame-grid" role="radiogroup" aria-label="Frame class">
      {tiles.map(({ frameClass: c, motors, supported }) => {
        const on = c === frameClass
        const name = names?.[c] ?? FRAME_CLASS_NAMES[c] ?? `Class ${c}`
        const cls = ['frame-tile', on ? 'frame-tile--on' : '', supported ? '' : 'frame-tile--off']
          .filter(Boolean)
          .join(' ')
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={on}
            className={cls}
            // In the tooltip, to keep text off the dimmed tiles.
            title={supported ? undefined : `ArduPilot has no ${name} ${typeName} frame`}
            onClick={() => onPick(c)}
          >
            <FrameDiagram motors={motors} className="frame-tile__art" />
            <span className="frame-tile__name">{name}</span>
          </button>
        )
      })}
    </div>
  )
}
