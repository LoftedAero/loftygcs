import { useEffect, useMemo, useRef, useState } from 'react'
import { LaButton, LaCard, LaModal, LaReadout, LaSelect, LaSwitch } from '../../components/La'
import OsdActions, { isOsdParam, OsdSettings, OSD_REBOOT_REASON } from './OsdActions'
import { ColumnToggle } from '../../components/ColumnShell'
import { ToolbarWrite } from '../../components/VehicleParamActions'
import CardParamActions from '../../components/CardParamActions'
import ParamField from '../../components/ParamField'
import WriteFeedback from '../../components/WriteFeedback'
import { useParamStore } from '../../../stores/param-store'
import { useWriteFeedbackStore } from '../../../stores/write-feedback-store'
import { connectionService } from '../../../services/connection'
import OsdScreen from './OsdScreen'
import { OSD_GROUP_LABELS, OSD_ITEMS, type OsdGroup } from './osd-items'
import {
  OSD_SCREENS,
  TEXT_RESOLUTIONS,
  TYPE_MSP_DISPLAYPORT,
  clampPlacement,
  editorGrid,
  findOffGrid,
  findOverlaps,
  paramName,
  readPlacements,
} from './osd-layout'
import { useCompact } from '../../compact'

// The OSD tab: panel toggles left, screen preview center, settings right,
// Betaflight's arrangement for fitting everything on one screen. The list
// scrolls in its own pane and the preview is capped by viewport height.
//
// Panels are dragged on the preview; the X/Y spinners are kept for exact
// placement of the selected panel. ArduPilot's four screens are whole
// layouts, so they are picked one at a time rather than as Betaflight's
// per-screen checkbox columns.
//
// Edits stage through the parameter store like any other parameter.

const MSP_TYPES = new Set([3, 5]) // MSP and MSP_DISPLAYPORT

export default function OsdWorkspace() {
  const entries = useParamStore((s) => s.entries)
  const metadata = useParamStore((s) => s.metadata)
  const edit = useParamStore((s) => s.edit)

  const [screen, setScreen] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [screenSettingsOpen, setScreenSettingsOpen] = useState(false)

  const osdType = entries.get('OSD_TYPE')?.value
  const txtResParam = `OSD${screen}_TXT_RES`
  const txtRes = entries.get(txtResParam)?.value
  const hdWanted = txtRes !== undefined && txtRes > 0
  const compact = useCompact()

  // A disabled screen's panels are not reported. With OSD2_ENABLE at 0,
  // ArduPlane 4.7.1 still reports Link quality (it sits outside the table the
  // enable hides), so the screen is treated as empty rather than listing one
  // lone panel. Enabling it brings all sixty in live.
  const enableParam = `OSD${screen}_ENABLE`
  const screenOff = (entries.get(enableParam)?.value ?? 1) === 0
  const placements = useMemo(
    () => (screenOff ? [] : readPlacements(entries, screen)),
    [entries, screen, screenOff],
  )
  // The grid drawn, which on DisplayPort can be larger than the one declared.
  const { grid, declared } = useMemo(
    () => editorGrid(osdType, txtRes, placements),
    [osdType, txtRes, placements],
  )
  const overlaps = useMemo(() => findOverlaps(placements), [placements])
  const offGrid = useMemo(() => findOffGrid(placements, grid), [placements, grid])
  const selected = placements.find((p) => p.item.id === selectedId) ?? null

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

  // With the OSD off the page still renders, disabled, so the column's
  // OSD_TYPE control stays reachable.
  const osdOff = !osdType

  // The screen's own settings, in the order the dialog shows them. The font
  // applies only to MSP DisplayPort, which draws its own characters.
  const screenParams = [
    `OSD${screen}_CHAN_MIN`,
    `OSD${screen}_CHAN_MAX`,
    `OSD${screen}_ESC_IDX`,
    ...(osdType === TYPE_MSP_DISPLAYPORT ? [`OSD${screen}_FONT`] : []),
  ].filter((p) => entries.has(p))
  const noPanels = placements.length === 0

  const bringBack = () => {
    for (const id of offGrid) {
      const p = placements.find((q) => q.item.id === id)
      if (p) move(id, p.x, p.y)
    }
  }

  // One line for the worst layout problem: panels off the grid, then
  // overlaps, then a grid the backend ignores. One line keeps the card's
  // height fixed, which the preview's height cap depends on.
  const layoutStatus =
    offGrid.size > 0
      ? `${offGrid.size} panel${offGrid.size === 1 ? '' : 's'} outside ${grid.label}`
      : overlaps.size > 0
        ? `${overlaps.size} panel${overlaps.size === 1 ? '' : 's'} overlapping`
        : hdWanted && osdType !== TYPE_MSP_DISPLAYPORT
          ? 'HD grid needs the MSP DisplayPort OSD type'
          : ''

  const pickScreen = (n: number) => {
    setScreen(n)
    setSelectedId(null)
  }
  const screens = OSD_SCREENS.filter((n) => entries.has(`OSD${n}_ENABLE`)).map((n) => ({
    n,
    on: (entries.get(`OSD${n}_ENABLE`)?.value ?? 0) !== 0,
  }))
  const enable = entries.has(enableParam) && <ScreenEnable param={enableParam} disabled={osdOff} />
  // ArduPilot draws the HD grids only over MSP DisplayPort, so the resolution
  // is a choice only there. A stored HD value on another backend is reported
  // by the status.
  const gridControl =
    entries.has(txtResParam) && osdType === TYPE_MSP_DISPLAYPORT ? (
      <label className="la-row osd-toolbar__res">
        <span className="la-field__label">Grid</span>
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
      // Same shape as the selectable case: a label and a value.
      <span className="la-row osd-toolbar__res">
        <span className="la-field__label">Grid</span>
        <LaReadout placeholder="—" value={grid.label} />
      </span>
    )
  const status = (
    <>
      {layoutStatus && (
        <span className="card-status card-status--bad" role="status" title={layoutStatus}>
          {layoutStatus}
        </span>
      )}
      {/* The fix for off-grid panels. */}
      {offGrid.size > 0 && (
        <LaButton variant="secondary" disabled={osdOff} onClick={bringBack}>
          Bring panels on screen
        </LaButton>
      )}
    </>
  )
  const preview = (
    // The box the preview is fitted into; see `.osd-screen-fit`.
    <div className="osd-screen-fit">
      <OsdScreen
        grid={grid}
        declared={declared}
        placements={placements}
        selectedId={selectedId}
        overlaps={overlaps}
        offGrid={offGrid}
        showNtscGuide={osdType !== TYPE_MSP_DISPLAYPORT}
        disabled={osdOff || screenOff}
        // With nothing to lay out, the Panels card explains why.
        {...(osdOff || screenOff ? { emptyText: null } : {})}
        onSelect={setSelectedId}
        onMove={move}
      />
    </div>
  )
  const selection = (
    <SelectionDetail
      compact={compact}
      selected={selected}
      grid={grid}
      osdType={osdType}
      disabled={osdOff}
      onMove={move}
      onDisable={(id) => {
        setEnabled(id, false)
        setSelectedId(null)
      }}
    />
  )

  // Alphabetical within each group, to make one of sixty-five easy to find.
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
      <LaCard title="Panels" className="osd-workspace__panels">
        <div className="osd-palette-scroll">
          {noPanels && (
            <p className="app-placeholder">
              {osdOff
                ? 'Enable OSD to configure.'
                : screenOff
                  ? `Enable screen ${screen} to configure.`
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

      {compact ? (
        // One bar of controls, then the preview at the card's full height
        // with the selected panel's controls beside it.
        <LaCard className="osd-workspace__screen">
          <div className="osd-bar">
            <LaSelect
              className="osd-bar__screen"
              aria-label="OSD screen"
              value={String(screen)}
              disabled={osdOff}
              onChange={(e) => pickScreen(Number(e.target.value))}
            >
              {screens.map(({ n, on }) => (
                <option key={n} value={n}>
                  Screen {n}
                  {on ? '' : ' (off)'}
                </option>
              ))}
            </LaSelect>
            {enable}
            {gridControl}
            <div className="osd-bar__end">
              {status}
              <ToolbarWrite owns={isOsdParam} reason={OSD_REBOOT_REASON} />
              <ColumnToggle />
            </div>
          </div>
          <div className="osd-stage">
            {preview}
            {selection}
          </div>
        </LaCard>
      ) : (
        <LaCard title="Screen layout" className="osd-workspace__screen" actions={status}>
          <div className="la-row la-row--between la-row--wrap osd-toolbar">
            <div className="la-radio-group" role="radiogroup" aria-label="OSD screen">
              {screens.map(({ n, on }) => (
                <label key={n} className="la-radio">
                  <input
                    type="radio"
                    name="osd-screen"
                    checked={screen === n}
                    disabled={osdOff}
                    onChange={() => pickScreen(n)}
                  />
                  <span className="la-radio__mark"></span>
                  <span className="la-radio__text">
                    Screen {n}
                    {/* A state, not a unit. */}
                    {!on && <span className="la-muted"> off</span>}
                  </span>
                </label>
              ))}
              {/* Beside the picker, since it applies to the screen picked there. */}
              {enable}
            </div>
            <div className="la-row osd-toolbar__right">{gridControl}</div>
          </div>
          {preview}
          {selection}
        </LaCard>
      )}

      <OsdActions>
        <OsdSettings
          title="Display"
          fields={[
            // Written immediately, not staged: at 0 the vehicle reports no
            // panel positions, and the quiet re-read after the write is what
            // brings them in.
            {
              param: 'OSD_TYPE',
              label: 'OSD type',
              writeNow: true,
              gatesOthers: true,
              // The full name is too long for the column's box.
              optionLabels: { 5: 'DisplayPort' },
            },
            { param: 'OSD_UNITS', label: 'Units' },
            { param: 'OSD_MSG_TIME', label: 'Message time', unit: 's' },
            { param: 'OSD_OPTIONS', label: 'Options' },
          ]}
        />
        {/* Screen switching: which channel, how, and the picked screen's own
            settings. Those are set rarely, so they sit behind a dialog, as
            Outputs' ESC settings do. */}
        <OsdSettings
          title="Screen controls"
          fields={[
            { param: 'OSD_CHAN', label: 'Channel' },
            {
              param: 'OSD_SW_METHOD',
              label: 'Method',
              // ArduPilot's names are sentences; short names fit the column,
              // and the sentence is the hover text.
              optionLabels: { 0: 'On change', 1: 'PWM range', 2: 'On high' },
            },
          ]}
        >
          {screenParams.length > 0 && (
            <div className="la-field">
              <label className="la-field__label">Screen {screen} settings</label>
              <LaButton variant="secondary" onClick={() => setScreenSettingsOpen(true)}>
                Configure
              </LaButton>
            </div>
          )}
        </OsdSettings>
        <OsdSettings
          title="Warnings"
          fields={[
            { param: 'OSD_W_BATVOLT', label: 'Battery', unit: 'V' },
            { param: 'OSD_W_AVGCELLV', label: 'Avg cell', unit: 'V' },
            { param: 'OSD_W_RSSI', label: 'RSSI' },
            { param: 'OSD_W_NSAT', label: 'Satellites' },
            { param: 'OSD_W_TERR', label: 'Terrain alt', unit: 'm' },
          ]}
        />
      </OsdActions>
      {screenSettingsOpen && (
        <ScreenSettingsModal
          screen={screen}
          params={screenParams}
          onClose={() => setScreenSettingsOpen(false)}
        />
      )}
    </div>
  )
}

const SCREEN_LABELS: Record<string, { label: string; unit?: string }> = {
  CHAN_MIN: { label: 'Switch PWM minimum', unit: 'µs' },
  CHAN_MAX: { label: 'Switch PWM maximum', unit: 'µs' },
  ESC_IDX: { label: 'ESC index' },
  FONT: { label: 'Font index' },
}

/**
 * One screen's own settings, in a dialog with its own Revert and Write, like
 * Outputs' ESC settings, so edits are not left staged out of sight. Close is
 * hidden while anything here is unwritten.
 *
 * The PWM band only matters when screens are switched by PWM range
 * (OSD_SW_METHOD 1); ESC index picks which ESC's telemetry the ESC panels
 * show, 0 being whichever reads highest.
 */
function ScreenSettingsModal({
  screen,
  params,
  onClose,
}: {
  screen: number
  params: string[]
  onClose: () => void
}) {
  const owns = (param: string) => params.includes(param)
  const pending = useParamStore((s) => {
    let n = 0
    for (const param of params) if (s.entries.get(param)?.dirty) n++
    return n
  })
  const writeBusy = useParamStore((s) => s.writeBusy)
  return (
    <LaModal
      open
      title={`Screen ${screen} settings`}
      actions={
        <>
          <CardParamActions reason="OSD changes take effect after a restart" owns={owns} />
          {pending === 0 && !writeBusy && (
            <LaButton variant="primary" onClick={onClose}>
              Close
            </LaButton>
          )}
        </>
      }
    >
      <div className="dialog-fields">
        {params.map((param) => {
          const spec = SCREEN_LABELS[param.replace(/^OSD\d_/, '')]
          return (
            <ParamField
              key={param}
              param={param}
              label={spec?.label ?? param}
              {...(spec?.unit ? { unit: spec.unit } : {})}
              showName
            />
          )
        })}
      </div>
    </LaModal>
  )
}

/**
 * A screen's enable, written as it is flipped.
 *
 * Like `OSD_TYPE` it gates what the page can show (a disabled screen's
 * panels are not reported), so it writes on change and then re-reads rather
 * than staging. A failed write stays staged for the column's Write.
 */
function ScreenEnable({ param, disabled }: { param: string; disabled: boolean }) {
  const entry = useParamStore((s) => s.entries.get(param))
  const edit = useParamStore((s) => s.edit)
  if (!entry) return null
  const commit = (on: boolean) => {
    const v = on ? 1 : 0
    edit(param, v)
    void connectionService
      .setParamNow(param, v)
      .then(() => {
        useWriteFeedbackStore.getState().report({ ok: true, param })
        return connectionService.refreshParams({ quiet: true })
      })
      .catch((err: unknown) => {
        useWriteFeedbackStore.getState().report({
          ok: false,
          param,
          ...(err instanceof Error && err.message ? { error: err.message } : {}),
        })
      })
  }
  return (
    <span className="param-control osd-toolbar__enable">
      <LaSwitch
        label="Enabled"
        checked={entry.value !== 0}
        disabled={disabled}
        onChange={(e) => commit(e.target.checked)}
      />
      <WriteFeedback params={[param]} inline />
    </span>
  )
}

/**
 * The selected panel's exact placement.
 *
 * One row, always drawn so the card's height does not change with the
 * selection. With nothing selected the controls are disabled.
 */
function SelectionDetail({
  compact,
  selected,
  grid,
  osdType,
  disabled,
  onMove,
  onDisable,
}: {
  compact: boolean
  selected: ReturnType<typeof readPlacements>[number] | null
  grid: { cols: number; rows: number }
  osdType: number | undefined
  disabled: boolean
  onMove: (id: string, x: number, y: number) => void
  onDisable: (id: string) => void
}) {
  const item = selected?.item ?? null
  const x = selected?.x ?? 0
  const y = selected?.y ?? 0
  const off = disabled || !item
  const mspGap = item?.mspOnly && osdType !== undefined && !MSP_TYPES.has(osdType)
  const coord = (axis: 'Column' | 'Row') => (
    <label className="osd-selection__coord">
      <span className="la-field__label">{axis}</span>
      <input
        className="la-input la-input--num"
        type="number"
        min={0}
        max={(axis === 'Column' ? grid.cols : grid.rows) - 1}
        value={axis === 'Column' ? x : y}
        disabled={off}
        onChange={(e) =>
          item &&
          (axis === 'Column'
            ? onMove(item.id, Number(e.target.value), y)
            : onMove(item.id, x, Number(e.target.value)))
        }
      />
    </label>
  )
  const remove = (
    <LaButton variant="ghost" disabled={off} onClick={() => item && onDisable(item.id)}>
      Remove
    </LaButton>
  )

  // Compact mode's strip beside the preview: the boxes for an exact value,
  // and a pad of arrows for a finger, which cannot use the arrow keys and
  // drags a small panel less precisely than a mouse.
  if (compact) {
    return (
      <div className="osd-selection osd-selection--pad">
        <strong className="osd-selection__name">{item ? item.label : 'No panel selected'}</strong>
        <div className="osd-selection__coords">
          {coord('Column')}
          {coord('Row')}
        </div>
        <NudgePad disabled={off} onNudge={(dx, dy) => item && onMove(item.id, x + dx, y + dy)} />
        {remove}
      </div>
    )
  }
  return (
    <div className="osd-selection">
      <div className="la-row la-row--between la-row--wrap">
        <strong className="osd-selection__name">
          {item ? item.label : 'No panel selected'}
          {/* In the row rather than under it, so it adds no height. */}
          {mspGap && <span className="la-muted"> · drawn only on an MSP OSD</span>}
        </strong>
        <div className="la-row">
          {coord('Column')}
          {coord('Row')}
          {remove}
        </div>
      </div>
    </div>
  )
}

/** How long a held arrow waits before repeating, and then how often. */
const REPEAT_DELAY_MS = 400
const REPEAT_EVERY_MS = 90

const NUDGE_ARROWS = [
  { dir: 'up', label: 'Move up', dx: 0, dy: -1, d: 'M1 6l5-5 5 5' },
  { dir: 'left', label: 'Move left', dx: -1, dy: 0, d: 'M6 1L1 6l5 5' },
  { dir: 'right', label: 'Move right', dx: 1, dy: 0, d: 'M1 1l5 5-5 5' },
  { dir: 'down', label: 'Move down', dx: 0, dy: 1, d: 'M1 1l5 5 5-5' },
] as const

/**
 * Four arrows that move the selected panel a cell at a time, repeating while
 * held as a key does.
 */
function NudgePad({
  disabled,
  onNudge,
}: {
  disabled: boolean
  onNudge: (dx: number, dy: number) => void
}) {
  // The latest callback, since it closes over the panel's position, which
  // changes with every step of a repeat.
  const nudgeRef = useRef(onNudge)
  nudgeRef.current = onNudge
  const timer = useRef<number | undefined>(undefined)
  const stop = () => {
    window.clearTimeout(timer.current)
    timer.current = undefined
  }
  useEffect(() => stop, [])

  const start = (dx: number, dy: number) => {
    stop()
    nudgeRef.current(dx, dy)
    const repeat = () => {
      nudgeRef.current(dx, dy)
      timer.current = window.setTimeout(repeat, REPEAT_EVERY_MS)
    }
    timer.current = window.setTimeout(repeat, REPEAT_DELAY_MS)
  }

  return (
    <div className="osd-nudge" role="group" aria-label="Move panel">
      {NUDGE_ARROWS.map((a) => (
        <button
          key={a.dir}
          type="button"
          className={`osd-nudge__btn osd-nudge__btn--${a.dir}`}
          aria-label={a.label}
          disabled={disabled}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            start(a.dx, a.dy)
          }}
          onPointerUp={stop}
          onPointerLeave={stop}
          onPointerCancel={stop}
          // Keyboard activation gets one step per press.
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              nudgeRef.current(a.dx, a.dy)
            }
          }}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d={a.d} />
          </svg>
        </button>
      ))}
    </div>
  )
}
