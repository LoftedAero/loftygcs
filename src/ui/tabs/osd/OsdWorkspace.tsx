import { useMemo, useState } from 'react'
import { LaButton, LaCard, LaHint, LaLinkButton, LaSelect, LaSwitch } from '../../components/La'
import OsdActions from './OsdActions'
import ParamCard from '../../components/ParamCard'
import { useParamStore } from '../../../stores/param-store'
import OsdScreen from './OsdScreen'
import { OSD_GROUP_LABELS, OSD_ITEMS, type OsdGroup } from './osd-items'
import {
  OSD_SCREENS,
  TEXT_RESOLUTIONS,
  TYPE_MSP_DISPLAYPORT,
  clampPlacement,
  findOffGrid,
  findOverlaps,
  paramName,
  readPlacements,
  screenGrid,
} from './osd-layout'

// The whole OSD tab: panel toggles left, screen preview center, global
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
  const txtResParam = `OSD${screen}_TXT_RES`
  const txtRes = entries.get(txtResParam)?.value
  const grid = screenGrid(osdType, txtRes)
  const hdWanted = txtRes !== undefined && txtRes > 0

  const placements = useMemo(() => readPlacements(entries, screen), [entries, screen])
  const overlaps = useMemo(() => findOverlaps(placements), [placements])
  const offGrid = useMemo(() => findOffGrid(placements, grid), [placements, grid])
  const selected = placements.find((p) => p.item.id === selectedId) ?? null

  const screenEnableParam = `OSD${screen}_ENABLE`
  const screenEnabled = (entries.get(screenEnableParam)?.value ?? 0) !== 0

  const move = (id: string, x: number, y: number) => {
    if (!osdType) return
    const item = OSD_ITEMS.find((i) => i.id === id)
    if (!item) return
    const at = clampPlacement(item, x, y, grid, metadata, screen)
    edit(paramName(screen, id, 'X'), at.x)
    edit(paramName(screen, id, 'Y'), at.y)
  }

  const setEnabled = (id: string, on: boolean) => {
    if (!osdType) return
    edit(paramName(screen, id, 'EN'), on ? 1 : 0)
    if (on) setSelectedId(id)
  }

  // The page draws itself with the OSD off, and did not: with OSD_TYPE at 0
  // this returned a lone card saying the firmware exposes no panels, which
  // replaced the whole workspace -- *including* the column holding the one
  // control that turns the OSD on. The state hid its own fix, and the only
  // way out was the Parameters table. Everything renders now; what changes
  // is that nothing can be edited until the OSD is on, which is also the
  // truth about the vehicle: with no backend there is nothing to lay out.
  const osdOff = !osdType
  const noPanels = placements.length === 0

  // Alphabetical inside each group. The catalog is written in a rough
  // reading order, which is fine for a spec and useless for finding one
  // panel among sixty-five.
  const byGroup = new Map<OsdGroup, typeof placements>()
  for (const p of placements) {
    const list = byGroup.get(p.item.group) ?? []
    list.push(p)
    byGroup.set(p.item.group, list)
  }
  for (const list of byGroup.values()) {
    list.sort((a, b) => a.item.label.localeCompare(b.item.label))
  }

  return (
    <div className="osd-workspace">
      <LaCard
        title="Panels"
        note="Positions are per screen."
        className="osd-workspace__panels"
      >
        <div className="osd-palette-scroll">
          {noPanels && (
            <p className="app-placeholder">
              {osdOff
                ? 'The vehicle reports no panel positions while its OSD is off. Turn it on beside this, write the change and reboot, and the layout appears here.'
                : `This firmware exposes no panel parameters for screen ${screen}.`}
            </p>
          )}
          {[...byGroup.entries()].map(([group, list]) => (
            <div key={group} className="osd-palette__group">
              <h3 className="osd-palette__heading">{OSD_GROUP_LABELS[group]}</h3>
              <div className="osd-palette">
                {list.map((p) => (
                  <LaSwitch
                    key={p.item.id}
                    label={p.item.label}
                    checked={p.enabled}
                    disabled={osdOff}
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
                    disabled={osdOff}
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
            {entries.has(txtResParam) ? (
              <label className="la-row osd-toolbar__res">
                <span className="la-field__unit">Grid</span>
                <LaSelect
                  value={String(txtRes ?? 0)}
                  disabled={osdOff}
                  className={entries.get(txtResParam)?.dirty ? 'is-dirty' : ''}
                  onChange={(e) => edit(txtResParam, Number(e.target.value))}
                >
                  {TEXT_RESOLUTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.grid.label}
                    </option>
                  ))}
                </LaSelect>
              </label>
            ) : (
              <span className="la-field__unit">{grid.label}</span>
            )}
            {entries.has(screenEnableParam) && (
              <LaSwitch
                label="Screen enabled"
                checked={screenEnabled}
                disabled={osdOff}
                onChange={(e) => edit(screenEnableParam, e.target.checked ? 1 : 0)}
              />
            )}
          </div>
        </div>

        {/* Picking an HD grid does nothing on its own: ArduPilot only draws
            the wider grids over MSP DisplayPort, and ignores TXT_RES on every
            other backend. Rather than let the selection look broken, say so
            and offer the one parameter change that makes it real. */}
        {hdWanted && osdType !== TYPE_MSP_DISPLAYPORT && (
          <LaHint>
            The vehicle draws 30×16 until its OSD type is MSP DisplayPort — HD text resolution is
            ignored on every other backend.{' '}
            {entries.has('OSD_TYPE') && (
              <LaLinkButton onClick={() => edit('OSD_TYPE', TYPE_MSP_DISPLAYPORT)}>
                Set OSD type to MSP DisplayPort
              </LaLinkButton>
            )}
          </LaHint>
        )}

        <OsdScreen
          grid={grid}
          placements={placements}
          selectedId={selectedId}
          overlaps={overlaps}
          offGrid={offGrid}
          showNtscGuide={osdType !== TYPE_MSP_DISPLAYPORT}
          disabled={osdOff}
          onSelect={setSelectedId}
          onMove={move}
        />

        <SelectionDetail
          selected={selected}
          grid={grid}
          osdType={osdType}
          overlapping={selectedId !== null && overlaps.has(selectedId)}
          disabled={osdOff}
          onMove={move}
          onDisable={(id) => {
            setEnabled(id, false)
            setSelectedId(null)
          }}
        />

        {offGrid.size > 0 && (
          <LaHint error>
            {offGrid.size} panel{offGrid.size === 1 ? ' sits' : 's sit'} outside {grid.label} and
            will not be drawn.{' '}
            <LaLinkButton
              onClick={() => {
                for (const id of offGrid) {
                  const p = placements.find((q) => q.item.id === id)
                  if (p) move(id, p.x, p.y)
                }
              }}
            >
              Bring {offGrid.size === 1 ? 'it' : 'them'} back on screen
            </LaLinkButton>
          </LaHint>
        )}

        {overlaps.size > 0 && (
          <LaHint error>
            {overlaps.size} panel{overlaps.size === 1 ? '' : 's'} overlap another. ArduPilot draws
            them in parameter order, so the later one wins and the other is unreadable.
          </LaHint>
        )}
      </LaCard>

      <div className="osd-workspace__side">
        {/* Actions first: what you do to the vehicle, above the settings you
            are doing it to. Same shape as the Parameters and Mission
            columns. */}
        <OsdActions />
        <ParamCard
          title="Display"
          fields={[
            // Written as soon as it is picked, not staged: with OSD_TYPE at
            // 0 the vehicle reports no panel positions at all, so staging it
            // leaves this page empty however many times you choose a
            // backend. The write is followed by a quiet re-read, which is
            // where the panel parameters come from.
            { param: 'OSD_TYPE', label: 'OSD type', writeNow: true },
            { param: 'OSD_UNITS', label: 'Units' },
            { param: 'OSD_MSG_TIME', label: 'Message time', unit: 's' },
            { param: 'OSD_SW_METHOD', label: 'Switch method' },
            { param: 'OSD_OPTIONS', label: 'Options' },
          ]}
        >
          {osdType === 0 && (
            <LaHint>
              The OSD is off, so nothing is drawn on the video feed. Screens can still be laid out,
              and take effect once a type is set — which needs a reboot.
            </LaHint>
          )}
        </ParamCard>

        <ParamCard
          title={`Screen ${screen} settings`}
          fields={[
            // Text resolution lives in the layout toolbar instead, beside the
            // grid it changes.
            ...(osdType === TYPE_MSP_DISPLAYPORT
              ? [{ param: `OSD${screen}_FONT`, label: 'Font index' }]
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
  disabled,
  onMove,
  onDisable,
}: {
  selected: ReturnType<typeof readPlacements>[number] | null
  grid: { cols: number; rows: number }
  osdType: number | undefined
  overlapping: boolean
  disabled: boolean
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
              disabled={disabled}
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
              disabled={disabled}
              onChange={(e) => onMove(item.id, x, Number(e.target.value))}
            />
          </label>
          <LaButton
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onDisable(item.id)}
          >
            Remove
          </LaButton>
        </div>
      </div>
      {mspGap && (
        <LaHint>
          ArduPilot draws this panel only on an MSP OSD. It stays configurable here, but the current
          OSD type will ignore it.
        </LaHint>
      )}
      {overlapping && <LaHint error>This panel overlaps another.</LaHint>}
    </div>
  )
}
