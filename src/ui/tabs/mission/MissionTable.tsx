import { LaButton, LaInput, LaLinkButton, LaSelect } from '../../components/La'
import { useUnits } from '../../../stores/preferences-store'
import { approachSlopes, homeElevation, type LegSlope } from '../../../services/mission-terrain'
import { useTerrain } from './use-terrain'
import { distanceLabel, formatDistance, fromDistance, toDistance } from '../../../units'
import { useMissionStore } from '../../../stores/mission-store'
import { usePlanVehicleClass } from './plan-vehicle'
import { legStats, hasCoords, type PlanItem } from '../../../protocol/mission-plan'
import {
  MAV_FRAMES,
  commandsFor,
  commandSpec,
  commandLabel,
} from '../../../protocol/mission-commands'

// The item table, Mission Planner's way: every item a row, every parameter
// editable in place, the command a dropdown so a row can become something
// else without being deleted and rebuilt.
//
// The four anonymous params are labelled per command from the catalog, which
// is the whole reason that catalog exists -- an unlabelled grid of param1..4
// is where Mission Planner loses people.

export default function MissionTable() {
  const units = useUnits()
  const plan = useMissionStore((s) => s.plan)
  const editing = useMissionStore((s) => s.editing)
  const selected = useMissionStore((s) => s.selected)
  const select = useMissionStore((s) => s.select)
  const update = useMissionStore((s) => s.updateItem)
  const remove = useMissionStore((s) => s.removeItem)
  const move = useMissionStore((s) => s.moveItem)
  const addAfter = useMissionStore((s) => s.addItemAfter)
  const stats = legStats(plan)
  // The same altitudes the profile is drawn from, so a leg between a
  // relative waypoint and an AMSL one still reads correctly.
  const terrain = useTerrain(plan, true)
  const home = homeElevation(plan, terrain.grids)
  const slopes = approachSlopes(plan, home.amslM, terrain.grids)

  if (plan.items.length === 0) {
    return (
      <div className="mission-table mission-table--empty">
        <p className="app-placeholder">
          {/* The palette is only shown while the mission is what clicks
              edit, so pointing at it from a fence would be pointing at
              nothing. */}
          {editing === 'mission' ? (
            <>
              No items yet. Click the map, or{' '}
              <LaLinkButton onClick={() => addAfter(-1)}>add a waypoint</LaLinkButton>.
            </>
          ) : (
            <>
              No mission items. Switch to <strong>Mission</strong> to plan a route.
            </>
          )}
        </p>
      </div>
    )
  }

  return (
    <div className="mission-table">
      <table className="mission-table__grid">
        {/* Fixed widths rather than the browser's guess. Auto layout gives
            the leftover width to whichever column has the widest content,
            which here is the four parameter cells -- so a waypoint, the
            command with the most parameters and the one everybody uses,
            got four input boxes wide enough for a paragraph. Sized for the
            longest label instead, with the slack going to the command
            names, which are the part that can actually run long. */}
        <colgroup>
          <col className="mission-col--seq" />
          <col className="mission-col--command" />
          <col className="mission-col--frame" />
          <col className="mission-col--alt" />
          <col className="mission-col--param" />
          <col className="mission-col--param" />
          <col className="mission-col--param" />
          <col className="mission-col--param" />
          <col className="mission-col--slope" />
          <col className="mission-col--slope" />
          <col className="mission-col--dist" />
          <col className="mission-col--actions" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="mission-table__num">
              #
            </th>
            <th scope="col">Command</th>
            <th scope="col">Frame</th>
            <th scope="col" className="mission-table__num">
              Alt ({distanceLabel(units.distance)})
            </th>
            <th scope="col" colSpan={4}>
              Parameters
            </th>
            <th scope="col" className="mission-table__num">
              Slope
            </th>
            <th scope="col" className="mission-table__num">
              Grade
            </th>
            <th scope="col" className="mission-table__num">
              Dist
            </th>
            {/* One add button, at the end of the row of labels rather than
                repeated down every line. It appends, which is what adding
                from a list means. */}
            <th scope="col" className="mission-table__actions">
              <LaButton
                variant="ghost"
                size="sm"
                aria-label="Add a waypoint at the end"
                title="Add a waypoint"
                onClick={() => addAfter(-1)}
              >
                +
              </LaButton>
            </th>
          </tr>
        </thead>
        <tbody>
          {plan.items.map((it, i) => (
            <Row
              key={it.uid}
              item={it}
              seq={i + 1}
              index={i}
              count={plan.items.length}
              legM={stats[i]?.legM ?? 0}
              slope={slopes.get(it.uid) ?? null}
              selected={selected === it.uid}
              onSelect={() => select(it.uid)}
              onChange={(patch) => update(it.uid, patch)}
              onRemove={() => remove(it.uid)}
              onMove={(to) => move(it.uid, to)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Row({
  item,
  seq,
  index,
  count,
  legM,
  slope,
  selected,
  onSelect,
  onChange,
  onRemove,
  onMove,
}: {
  item: PlanItem
  seq: number
  index: number
  count: number
  legM: number
  slope: LegSlope | null
  selected: boolean
  onSelect: () => void
  onChange: (patch: Partial<Omit<PlanItem, 'uid'>>) => void
  onRemove: () => void
  onMove: (to: number) => void
}) {
  // Which commands this aircraft accepts. Read here rather than passed in:
  // it is the same answer for every row, and threading it through the table
  // would put a prop on Row that has nothing to do with the row.
  const planClass = usePlanVehicleClass()
  const units = useUnits()
  const spec = commandSpec(item.command)
  const params = spec?.params ?? []

  return (
    <tr
      className={`mission-row${selected ? ' is-selected' : ''}`}
      onFocus={onSelect}
      onClick={onSelect}
    >
      <td className="mission-table__num">{seq}</td>

      <td>
        <LaSelect
          aria-label={`Item ${seq} command`}
          value={item.command}
          onChange={(e) => onChange(commandChange(Number(e.target.value)))}
        >
          {/* An unknown command keeps its own entry rather than snapping to
              whatever happens to be first in the list. */}
          {!spec && <option value={item.command}>{commandLabel(item.command)}</option>}
          {/* ArduPilot's own names, as in the palette's More list: anyone
              reaching into this column is working from the mission command
              reference, and a friendlier word only makes them guess which
              of ours is the one they read about. */}
          {commandsFor(planClass).map((c) => (
            <option key={c.id} value={c.id}>
              {c.mavName}
            </option>
          ))}
        </LaSelect>
      </td>

      <td>
        {spec && !spec.location && !spec.altitude ? (
          <span className="mission-table__dash">—</span>
        ) : (
          <LaSelect
            aria-label={`Item ${seq} frame`}
            value={item.frame}
            onChange={(e) => onChange({ frame: Number(e.target.value) })}
          >
            {MAV_FRAMES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.short}
              </option>
            ))}
          </LaSelect>
        )}
      </td>

      <td className="mission-table__num">
        {spec?.altitude === false ? (
          <span className="mission-table__dash">—</span>
        ) : (
          <LaInput
            num
            type="number"
            aria-label={`Item ${seq} altitude`}
            value={round(toDistance(item.z, units.distance))}
            onChange={(e) => onChange({ z: fromDistance(Number(e.target.value), units.distance) })}
          />
        )}
      </td>

      {[1, 2, 3, 4].map((n) => {
        const p = params.find((x) => x.index === n)
        const key = `param${n}` as 'param1' | 'param2' | 'param3' | 'param4'
        if (!p) {
          return (
            <td key={n} className="mission-table__param">
              <span className="mission-table__dash">—</span>
            </td>
          )
        }
        return (
          <td key={n} className="mission-table__param">
            <label className="mission-table__plabel" htmlFor={`${item.uid}-p${n}`}>
              {p.label} {p.unit && <span className="la-field__unit">{p.unit}</span>}
            </label>
            {p.options ? (
              <LaSelect
                id={`${item.uid}-p${n}`}
                value={item[key]}
                onChange={(e) => onChange({ [key]: Number(e.target.value) })}
              >
                {p.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </LaSelect>
            ) : (
              <LaInput
                num
                id={`${item.uid}-p${n}`}
                type="number"
                step={p.integer ? 1 : 'any'}
                {...(p.min !== undefined ? { min: p.min } : {})}
                {...(p.max !== undefined ? { max: p.max } : {})}
                value={round(item[key])}
                onChange={(e) => onChange({ [key]: Number(e.target.value) })}
              />
            )}
          </td>
        )
      })}

      <td className="mission-table__num mission-table__dist">
        {slope ? `${slope.deg.toFixed(1)}°` : <span className="mission-table__dash">—</span>}
      </td>
      <td className="mission-table__num mission-table__dist">
        {slope ? `${slope.percent.toFixed(1)}%` : <span className="mission-table__dash">—</span>}
      </td>
      <td className="mission-table__num mission-table__dist">
        {hasCoords(item) ? (
          `${formatDistance(legM, units.distance, 0)} ${distanceLabel(units.distance)}`
        ) : (
          <span className="mission-table__dash">—</span>
        )}
      </td>

      <td className="mission-table__actions">
        <LaButton
          variant="ghost"
          size="sm"
          aria-label={`Move item ${seq} up`}
          disabled={index === 0}
          onClick={() => onMove(index - 1)}
        >
          ↑
        </LaButton>
        <LaButton
          variant="ghost"
          size="sm"
          aria-label={`Move item ${seq} down`}
          disabled={index === count - 1}
          onClick={() => onMove(index + 1)}
        >
          ↓
        </LaButton>
        <LaButton variant="ghost" size="sm" aria-label={`Delete item ${seq}`} onClick={onRemove}>
          ✕
        </LaButton>
      </td>
    </tr>
  )
}

/**
 * Changing a row's command clears the parameters, because they mean
 * different things now -- a hold time of 15 becoming 15 turns of a loiter
 * is the kind of surprise that flies a mission nobody planned. Position is
 * kept: the point on the map is still the point that was chosen.
 */
function commandChange(command: number): Partial<Omit<PlanItem, 'uid'>> {
  const spec = commandSpec(command)
  return {
    command,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    ...(spec && !spec.location ? { x: 0, y: 0 } : {}),
    ...(spec?.altitude === false ? { z: 0 } : {}),
  }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}
