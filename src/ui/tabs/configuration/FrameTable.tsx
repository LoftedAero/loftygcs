import FrameDiagram from './FrameDiagram'
import { FRAME_CLASS_NAMES, frameTiles } from '../../../protocol/frame-layout'
import { useParamStore } from '../../../stores/param-store'

// Every frame we can picture, with the chosen one marked -- a picker made of
// the pictures rather than a dropdown with a picture beside it.
//
// The set is the same whatever the frame type, and no tile is ever blank. Two
// things go wrong otherwise, and both were worth designing against: a grid
// that grows and shrinks while somebody arrows through the type dropdown
// cannot be read, and a blank tile beside a drawn one says "this pairing does
// not exist, that one does" -- which is exactly backwards when the blank one
// is the aircraft you have selected.
//
// So a class that does not take the chosen type keeps its picture, drawn in
// its own canonical shape and dimmed. The dimming is what says the pairing is
// not available; the card's title row names it outright when it is the one
// you have selected.
//
// Blue for the selection, not orange: this is a working control showing its
// state, and the orange on this screen belongs to the staged-edit highlight
// and to Write.
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
            // Said in the hover rather than on the tile: a line of text under
            // every dimmed picture would be a paragraph across the grid.
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
