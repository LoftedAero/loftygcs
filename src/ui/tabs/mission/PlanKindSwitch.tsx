import { useMissionStore, type PlanKind } from '../../../stores/mission-store'

// Which of the three plans map clicks edit. All three stay drawn, since each
// only makes sense relative to the others; the map dims the two not being
// edited.

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
