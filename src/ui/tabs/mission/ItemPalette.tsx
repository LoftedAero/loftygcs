import { useState } from 'react'
import { LaSelect } from '../../components/La'
import {
  MISSION_COMMANDS,
  PALETTE_COMMANDS,
  commandSpec,
} from '../../../protocol/mission-commands'
import { useMissionStore } from '../../../stores/mission-store'

// The add-an-item palette, floating over the map.
//
// QGroundControl's idea: the five things you place ninety percent of the
// time are buttons, and everything else is behind one "Other" control that
// adds a generic item -- which is Mission Planner's model, where the command
// is a dropdown on the row. Between them they cover both habits without a
// menu of forty commands nobody can scan.
//
// A button arms a tool rather than adding immediately: an item needs a
// position, and the honest way to ask for one is to let the next map click
// be the answer. Clicking the armed button again disarms it.

export interface ItemPaletteProps {
  tool: number | null
  onTool: (command: number | null) => void
}

export default function ItemPalette({ tool, onTool }: ItemPaletteProps) {
  const addItem = useMissionStore((s) => s.addItem)
  const [other, setOther] = useState('')

  const arm = (command: number) => onTool(tool === command ? null : command)

  return (
    <div className="mission-palette" role="toolbar" aria-label="Add mission item">
      <span className="mission-palette__label">Add</span>
      {PALETTE_COMMANDS.map((id) => {
        const spec = commandSpec(id)!
        const armed = tool === id
        return (
          <button
            key={id}
            type="button"
            className={`mission-palette__btn${armed ? ' is-armed' : ''}`}
            aria-pressed={armed}
            title={spec.summary}
            onClick={() => {
              // Commands with no position have nothing to click for, so
              // they are appended the moment they are chosen.
              if (!spec.location) {
                addItem(id)
                onTool(null)
              } else arm(id)
            }}
          >
            {spec.name}
          </button>
        )
      })}

      <button
        type="button"
        className={`mission-palette__btn${tool === -1 ? ' is-armed' : ''}`}
        aria-pressed={tool === -1}
        title="Place the planned home position"
        onClick={() => arm(-1)}
      >
        Home
      </button>

      <LaSelect
        className="mission-palette__other"
        aria-label="Other command"
        value={other}
        onChange={(e) => {
          const id = Number(e.target.value)
          if (!Number.isFinite(id) || e.target.value === '') return
          const spec = commandSpec(id)
          if (spec?.location) onTool(id)
          else addItem(id)
          // Reset so choosing the same command twice in a row still fires.
          setOther('')
        }}
      >
        <option value="">Other…</option>
        {(['nav', 'condition', 'do'] as const).map((cat) => (
          <optgroup key={cat} label={CATEGORY[cat]}>
            {MISSION_COMMANDS.filter((c) => c.category === cat).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ))}
      </LaSelect>

      {tool !== null && (
        <span className="mission-palette__hint">
          Click the map to place{tool === -1 ? ' home' : ''}
        </span>
      )}
    </div>
  )
}

const CATEGORY = {
  nav: 'Navigation — the vehicle moves',
  condition: 'Conditions — wait for something',
  do: 'Actions — run and continue',
} as const
