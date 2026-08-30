import { useMemo, useState } from 'react'
import { LaButton, LaCard, LaHint, LaSwitch } from '../../components/La'
import ParamCard from '../../components/ParamCard'
import { useParamStore } from '../../../stores/param-store'
import OsdScreen from './OsdScreen'
import { OSD_GROUP_LABELS, OSD_ITEMS, type OsdGroup } from './osd-items'
import {
  OSD_SCREENS,
  clampPlacement,
  findOverlaps,
  paramName,
  readPlacements,
  screenGrid,
} from './osd-layout'

// The whole OSD tab: panel toggles left, screen preview centre, global
// settings right -- Betaflight's arrangement, which exists to put everything
// on one screen without scrolling. The list scrolls inside its own pane and
// the preview is capped by viewport height so the rest never moves.
//
// Mission Planner's OSD tool is the reference for *what* is configurable --
// four screens, the same sixty-five panels, the same parameters underneath --
// but not for how it is edited: it offers a table of X/Y spinners beside a
// preview. Panels are dragged on the preview itself here, and the spinners
// are kept for the selected panel, where they are useful for exact placement
// rather than being the only way to move anything. The one thing not taken
// from Betaflight is its per-screen checkbox columns: ArduPilot's four
// screens are whole layouts, so they are picked one at a time.
//
// Everything here stages through the parameter store, so an edit is a dirty
// parameter like any other and the action bar's Write is what sends it.

const MSP_TYPES = new Set([3, 5]) // MSP and MSP_DISPLAYPORT

export default function OsdWorkspace() {
  const entries = useParamStore((s) => s.entries)
  const metadata = useParamStore((s) => s.metadata)
  const edit = useParamStore((s) => s.edit)

  const [screen, setScreen] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const osdType = entries.get('OSD_TYPE')?.value
  const txtRes = entries.get(`OSD${screen}_TXT_RES`)?.value
  const grid = screenGrid(osdType, txtRes)

  const placements = useMemo(() => readPlacements(entries, screen), [entries, screen])
  const overlaps = useMemo(() => findOverlaps(placements), [placements])
  const selected = placements.find((p) => p.item.id === selectedId) ?? null

  const screenEnableParam = `OSD${screen}_ENABLE`
  const screenEnabled = (entries.get(screenEnableParam)?.value ?? 0) !== 0

  const move = (id: string, x: number, y: number) => {
    const item = OSD_ITEMS.find((i) => i.id === id)
    if (!item) return
    const at = clampPlacement(item, x, y, grid, metadata, screen)
    edit(paramName(screen, id, 'X'), at.x)
    edit(paramName(screen, id, 'Y'), at.y)
  }

  const setEnabled = (id: string, on: boolean) => {
    edit(paramName(screen, id, 'EN'), on ? 1 : 0)
    if (on) setSelectedId(id)
  }

  if (placements.length === 0) {
    return (
      <LaCard title="Screen layout">
        <p className="app-placeholder">
          This firmware exposes no panel parameters for screen {screen}.
        </p>
      </LaCard>
    )
  }

  const byGroup = new Map<OsdGroup, typeof placements>()
  for (const p of placements) {
    const list = byGroup.get(p.item.group) ?? []
    list.push(p)
    byGroup.set(p.item.group, list)
  }

  return (
    <div className="osd-workspace">
      <LaCard
        title="Panels"
        note="Panels this firmware does not support are not listed. Positions are per screen."
        className="osd-workspace__panels"
      >
        <div className="osd-palette-scroll">
          {[...byGroup.entries()].map(([group, list]) => (
            <div key={group} className="osd-palette__group">
              <h3 className="osd-palette__heading">{OSD_GROUP_LABELS[group]}</h3>
              <div className="osd-palette">
                {list.map((p) => (
                  <LaSwitch
                    key={p.item.id}
                    label={p.item.label}
                    checked={p.enabled}
                    onChange={(e) => setEnabled(p.item.id, e.target.checked)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </LaCard>

      <LaCard title="Screen layout" className="osd-workspace__screen">
        <div className="la-row la-row--between la-row--wrap osd-toolbar">
          <div className="la-radio-group" role="radiogroup" aria-label="OSD screen">
            {OSD_SCREENS.map((n) => {
              const present = entries.has(`OSD${n}_ENABLE`)
              if (!present) return null
              const on = (entries.get(`OSD${n}_ENABLE`)?.value ?? 0) !== 0
              return (
                <label key={n} className="la-radio">
                  <input
                    type="radio"
                    name="osd-screen"
                    checked={screen === n}
                    onChange={() => {
                      setScreen(n)
                      setSelectedId(null)
                    }}
                  />
                  <span className="la-radio__mark"></span>
                  <span className="la-radio__text">
                    Screen {n}
                    {!on && <span className="la-field__unit"> off</span>}
                  </span>
                </label>
              )
            })}
          </div>
          <div className="la-row osd-toolbar__right">
            <span className="la-field__unit">{grid.label}</span>
            {entries.has(screenEnableParam) && (
              <LaSwitch
                label="Screen enabled"
                checked={screenEnabled}
                onChange={(e) => edit(screenEnableParam, e.target.checked ? 1 : 0)}
              />
            )}
          </div>
        </div>

        <OsdScreen
          grid={grid}
          placements={placements}
          selectedId={selectedId}
          overlaps={overlaps}
          showNtscGuide={osdType !== 5}
          onSelect={setSelectedId}
          onMove={move}
        />

        <SelectionDetail
          selected={selected}
          grid={grid}
          osdType={osdType}
          overlapping={selectedId !== null && overlaps.has(selectedId)}
          onMove={move}
          onDisable={(id) => {
            setEnabled(id, false)
            setSelectedId(null)
          }}
        />

        {overlaps.size > 0 && (
          <LaHint error>
            {overlaps.size} panel{overlaps.size === 1 ? '' : 's'} overlap another. ArduPilot draws
            them in parameter order, so the later one wins and the other is unreadable.
          </LaHint>
        )}
      </LaCard>

      <div className="osd-workspace__side">
        <ParamCard
          title="Display"
          fields={[
            { param: 'OSD_TYPE', label: 'OSD type' },
            { param: 'OSD_UNITS', label: 'Units' },
            { param: 'OSD_MSG_TIME', label: 'Message time', unit: 's' },
            { param: 'OSD_SW_METHOD', label: 'Switch method' },
            { param: 'OSD_OPTIONS', label: 'Options' },
          ]}
        >
          {osdType === 0 && (
            <LaHint>
              The OSD is off, so nothing is drawn on the video feed. Screens can still be laid
              out, and take effect once a type is set — which needs a reboot.
            </LaHint>
          )}
        </ParamCard>

        <ParamCard
          title={`Screen ${screen} settings`}
          fields={[
            ...(osdType === 5
              ? [
                  { param: `OSD${screen}_TXT_RES`, label: 'Text resolution' },
                  { param: `OSD${screen}_FONT`, label: 'Font index' },
                ]
              : []),
            { param: `OSD${screen}_CHAN_MIN`, label: 'Switch PWM minimum', unit: 'µs' },
            { param: `OSD${screen}_CHAN_MAX`, label: 'Switch PWM maximum', unit: 'µs' },
            { param: `OSD${screen}_ESC_IDX`, label: 'ESC index' },
          ]}
        />

        <ParamCard
          title="Warnings"
          note="OSD highlights only, separate from the vehicle's failsafes."
          fields={[
            { param: 'OSD_W_BATVOLT', label: 'Battery voltage', unit: 'V' },
            { param: 'OSD_W_RSSI', label: 'RSSI' },
            { param: 'OSD_W_NSAT', label: 'Satellite count' },
            { param: 'OSD_W_TERR', label: 'Terrain altitude', unit: 'm' },
            { param: 'OSD_W_AVGCELLV', label: 'Average cell voltage', unit: 'V' },
          ]}
        />
      </div>
    </div>
  )
}

function SelectionDetail({
  selected,
  grid,
  osdType,
  overlapping,
  onMove,
  onDisable,
}: {
  selected: ReturnType<typeof readPlacements>[number] | null
  grid: { cols: number; rows: number }
  osdType: number | undefined
  overlapping: boolean
  onMove: (id: string, x: number, y: number) => void
  onDisable: (id: string) => void
}) {
  if (!selected) {
    return (
      <p className="la-hint osd-selection osd-selection--empty">
        Select a panel to place it exactly. Drag to move; arrow keys nudge, with Shift for five
        cells at a time.
      </p>
    )
  }
  const { item, x, y } = selected
  const mspGap = item.mspOnly && osdType !== undefined && !MSP_TYPES.has(osdType)
  return (
    <div className="osd-selection">
      <div className="la-row la-row--between la-row--wrap">
        <strong className="osd-selection__name">{item.label}</strong>
        <div className="la-row">
          <label className="la-field la-field--stacked osd-selection__coord">
            <span className="la-field__label">Column</span>
            <input
              className="la-input la-input--num"
              type="number"
              min={0}
              max={grid.cols - 1}
              value={x}
              onChange={(e) => onMove(item.id, Number(e.target.value), y)}
            />
          </label>
          <label className="la-field la-field--stacked osd-selection__coord">
            <span className="la-field__label">Row</span>
            <input
              className="la-input la-input--num"
              type="number"
              min={0}
              max={grid.rows - 1}
              value={y}
              onChange={(e) => onMove(item.id, x, Number(e.target.value))}
            />
          </label>
          <LaButton variant="ghost" size="sm" onClick={() => onDisable(item.id)}>
            Remove
          </LaButton>
        </div>
      </div>
      {mspGap && (
        <LaHint>
          ArduPilot draws this panel only on an MSP OSD. It stays configurable here, but the
          current OSD type will ignore it.
        </LaHint>
      )}
      {overlapping && <LaHint error>This panel overlaps another.</LaHint>}
    </div>
  )
}
