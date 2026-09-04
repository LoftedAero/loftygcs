import { useMissionStore, type PlanKind } from '../../../stores/mission-store'

// Which of the three plans the map clicks belong to.
//
// A switch rather than three screens: a fence is only useful in relation to
// the mission inside it, and a rally point is only useful in relation to
// both. All three stay drawn on the map whichever is selected -- this
// chooses what you are *editing*, and the map dims the other two so it is
// obvious which one that is.

const KINDS: { id: PlanKind; label: string }[] = [
  { id: 'mission', label: 'Mission' },
  { id: 'fence', label: 'Fence' },
  { id: 'rally', label: 'Rally' },
]

export default function PlanKindSwitch() {
  const editing = useMissionStore((s) => s.editing)
  const setEditing = useMissionStore((s) => s.setEditing)

  return (
    <div className="plan-switch" role="tablist" aria-label="What to edit">
      {KINDS.map((k) => (
        <button
          key={k.id}
          type="button"
          role="tab"
          aria-selected={editing === k.id}
          className={`plan-switch__btn${editing === k.id ? ' is-active' : ''}`}
          onClick={() => setEditing(k.id)}
        >
          {k.label}
        </button>
      ))}
    </div>
  )
}
