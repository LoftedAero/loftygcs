import { useEffect, useRef, useState } from 'react'
import { LaButton, LaHint, LaInput, LaModal, LaSelect, LaSwitch } from '../../components/La'
import { useJoystickStore } from '../../../stores/joystick-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { modeTable } from '../../../protocol/modes'
import { nextFreeChannel, useLearn } from './joystick-learn'
import {
  CHANNELS,
  channelName,
  conflictingChannels,
  defaultValues,
  PWM_LIMIT_MAX,
  PWM_LIMIT_MIN,
  sanitizeConfig,
  type AxisMap,
  type ButtonMap,
  type ButtonMode,
  type JoystickConfig,
} from '../../../protocol/joystick'

// Mapping a device: which control drives which channel, and how.
//
// A dialog rather than a page: it is opened once for a new device and then
// rarely, and it cannot be opened while control is taken. Every change is the
// current device's own mapping at once (joystick-store), so there is no Save
// for the mapping itself -- the profile controls are for naming it, moving it
// between devices, and taking it to another machine.
//
// The two tables share their columns -- channel, the control and its Learn,
// how it behaves, what it sends, remove -- so the eye runs down one set of
// columns through both, and every button in the dialog is one width.

const MODE_LABELS: Record<ButtonMode, string> = {
  momentary: 'Momentary',
  toggle: 'Toggle',
  set: 'Set',
  mode: 'Flight mode',
}

type Note = { text: string; bad?: boolean } | null

/** Two mappings are the same. Sanitized first, so key order cannot make them differ. */
const sameMapping = (a: JoystickConfig, b: JoystickConfig) =>
  JSON.stringify(sanitizeConfig(a)) === JSON.stringify(sanitizeConfig(b))

export default function JoystickSetup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const config = useJoystickStore((s) => s.config)
  const setConfig = useJoystickStore((s) => s.setConfig)
  const axes = useJoystickStore((s) => s.axes)
  const buttons = useJoystickStore((s) => s.buttons)
  const channels = useJoystickStore((s) => s.channels)
  const profiles = useJoystickStore((s) => s.profiles)
  const importProfile = useJoystickStore((s) => s.importProfile)
  const load = useJoystickStore((s) => s.loadProfile)
  const learn = useLearn()
  const [picked, setPicked] = useState('')
  const [note, setNote] = useState<Note>(null)
  const [replacing, setReplacing] = useState<{ name: string; config: JoystickConfig } | null>(null)
  const current = picked && profiles[picked] ? picked : ''

  // A result says what happened and then gets out of the way.
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 4000)
    return () => clearTimeout(t)
  }, [note])

  // Read from the store rather than this render's `config`: a Learn resolves
  // renders later, and must not write back a mapping from before it began.
  const now = () => useJoystickStore.getState().config
  const setAxis = (i: number, patch: Partial<AxisMap>) => {
    setConfig({ axes: now().axes.map((a, j) => (j === i ? { ...a, ...patch } : a)) })
  }
  const setButton = (i: number, patch: Partial<ButtonMap>) => {
    setConfig({ buttons: now().buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)) })
  }
  const conflicts = conflictingChannels(config)
  const learnLabel = (key: string) => (learn.listening === key ? 'Listening' : 'Learn')

  // Export writes the profile picked in the list, as Load and Delete act on
  // it; with none picked, the mapping in use. It used to write the mapping in
  // use under the picked profile's name, which labeled one mapping with
  // another's name whenever the two differed.
  const saveToFile = () => {
    const name = current || 'Gamepad'
    const config = current ? profiles[current]! : useJoystickStore.getState().config
    const blob = new Blob(
      [JSON.stringify({ kind: 'loftgcs-joystick-profile', version: 1, name, config }, null, 2)],
      { type: 'application/json' },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}.joystick.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const openFromFile = async (f: File) => {
    try {
      const parsed = JSON.parse(await f.text()) as { name?: unknown; config?: unknown }
      // A file from this app wraps the mapping; a bare mapping is read too.
      const cfg =
        parsed && typeof parsed === 'object' && 'config' in parsed ? parsed.config : parsed
      // Sanitizing anything at all yields the default mapping, so a JSON file
      // that is not a mapping would load as one. Ask for the shape first.
      const shaped =
        cfg !== null &&
        typeof cfg === 'object' &&
        (Array.isArray((cfg as { axes?: unknown }).axes) ||
          Array.isArray((cfg as { buttons?: unknown }).buttons))
      if (!shaped) throw new Error('not a mapping')
      const name =
        typeof parsed.name === 'string' && parsed.name.trim()
          ? parsed.name.trim()
          : f.name.replace(/(\.joystick)?\.json$/i, '')
      const incoming = sanitizeConfig(cfg)
      const existing = useJoystickStore.getState().profiles[name]
      // A different profile under the same name is asked about; the same one
      // again is not, since replacing it changes nothing.
      if (existing && !sameMapping(existing, incoming)) setReplacing({ name, config: incoming })
      else keepOpened(name, incoming)
    } catch {
      setNote({ text: 'That file is not a joystick profile.', bad: true })
    }
  }

  const keepOpened = (name: string, incoming: JoystickConfig) => {
    importProfile(name, incoming)
    load(name)
    setPicked(name)
    setNote({ text: `Loaded ${name}` })
  }

  return (
    <>
      <LaModal
        open={open}
        wide
        title="Gamepad settings"
        actions={
          <LaButton
            variant="primary"
            onClick={() => {
              learn.cancel()
              onClose()
            }}
          >
            Close
          </LaButton>
        }
      >
        <div className="js-setup">
          <Profiles
            picked={current}
            onPick={setPicked}
            note={note}
            onNote={setNote}
            onSaveToFile={saveToFile}
            onOpenFromFile={(f) => void openFromFile(f)}
          />

          <section className="js-setup__group">
            <h4 className="js-setup__head">Sticks and sliders</h4>
            <div className="app-table">
              <div className="app-table__row app-table__head js-grid js-grid--axes">
                <span>Channel</span>
                <span>Axis</span>
                <span>Reverse</span>
                <span>Centered</span>
                <span>Expo</span>
                <span />
                <span className="js-grid__num">Sends</span>
                <span />
              </div>
              {config.axes.map((m, i) => (
                <div
                  key={i}
                  className={`app-table__row js-grid js-grid--axes${conflicts.includes(m.channel) ? ' is-bad' : ''}`}
                >
                  <ChannelSelect
                    value={m.channel}
                    onChange={(channel) => setAxis(i, { channel })}
                  />
                  <div className="js-grid__pick">
                    <LaSelect
                      aria-label={`Axis for channel ${m.channel}`}
                      value={String(m.axis)}
                      onChange={(e) => setAxis(i, { axis: Number(e.target.value) })}
                    >
                      <option value="-1">None</option>
                      {optionsFor(axes.length, m.axis).map((n) => (
                        <option key={n} value={n}>
                          Axis {n}
                        </option>
                      ))}
                    </LaSelect>
                    <LaButton
                      variant="ghost"
                      onClick={() =>
                        learn.start(`axis${i}`, 'axis', (axis) => setAxis(i, { axis }))
                      }
                    >
                      {learnLabel(`axis${i}`)}
                    </LaButton>
                  </div>
                  <LaSwitch
                    label=""
                    aria-label={`Reverse channel ${m.channel}`}
                    checked={m.reverse}
                    onChange={(e) => setAxis(i, { reverse: e.target.checked })}
                  />
                  {/* Beside Expo, which it enables: only a stick that springs
                      back has a center for expo to soften. */}
                  <LaSwitch
                    label=""
                    aria-label={`Channel ${m.channel} springs back to center`}
                    checked={m.centered}
                    onChange={(e) => setAxis(i, { centered: e.target.checked })}
                  />
                  <LaInput
                    type="number"
                    aria-label={`Expo for channel ${m.channel}`}
                    className="js-grid__expo"
                    min={0}
                    max={100}
                    step={5}
                    disabled={!m.centered}
                    value={Math.round(m.expo * 100)}
                    onChange={(e) => setAxis(i, { expo: Number(e.target.value) / 100 })}
                  />
                  <span />
                  <span className="js-grid__num">{live(channels[m.channel - 1], m.axis >= 0)}</span>
                  <RemoveButton
                    label={`Remove the mapping for channel ${m.channel}`}
                    onClick={() => setConfig({ axes: now().axes.filter((_, j) => j !== i) })}
                  />
                </div>
              ))}
            </div>
            <LaButton
              variant="ghost"
              onClick={() =>
                setConfig({
                  axes: [
                    ...now().axes,
                    {
                      channel: nextFreeChannel(now()),
                      axis: -1,
                      reverse: false,
                      centered: false,
                      expo: 0,
                    },
                  ],
                })
              }
            >
              Add axis
            </LaButton>
            {/* With the sticks it shapes: a deadzone is around a centered
                stick's middle, and nothing else in the dialog uses one. On
                the table's first two columns, so the box sits under the
                controls above it. */}
            <div className="js-setup__fields">
              <label className="js-setup__label" htmlFor="js-deadzone">
                Deadzone
              </label>
              <div className="js-grid__pick">
                <LaInput
                  id="js-deadzone"
                  type="number"
                  min={0}
                  max={40}
                  value={Math.round(config.deadzone * 100)}
                  onChange={(e) => setConfig({ deadzone: Number(e.target.value) / 100 })}
                />
                <span className="la-field__unit">%</span>
              </div>
            </div>
          </section>

          <section className="js-setup__group">
            <h4 className="js-setup__head">Buttons</h4>
            <div className="app-table">
              <div className="app-table__row app-table__head js-grid js-grid--buttons">
                <span>Channel</span>
                <span>Button</span>
                <span>Acts as</span>
                {/* Microseconds or a flight mode, by what the button does; the
                    unit is beside each box that takes one. */}
                <span>Value</span>
                <span className="js-grid__num">Sends</span>
                <span />
              </div>
              {config.buttons.map((m, i) => {
                const flightMode = m.mode === 'mode'
                // A mode button has no channel, so it is named by its row.
                const who = flightMode ? `flight mode row ${i + 1}` : `channel ${m.channel}`
                return (
                  <div
                    key={i}
                    className={`app-table__row js-grid js-grid--buttons${!flightMode && conflicts.includes(m.channel) ? ' is-bad' : ''}`}
                  >
                    {flightMode ? (
                      // Drawn disabled rather than left empty, so the row keeps
                      // the table's shape.
                      <LaSelect aria-label={`Channel for ${who}`} disabled value="">
                        <option value="">—</option>
                      </LaSelect>
                    ) : (
                      <ChannelSelect
                        value={m.channel}
                        onChange={(channel) => setButton(i, { channel })}
                      />
                    )}
                    <div className="js-grid__pick">
                      <LaSelect
                        aria-label={`Button for ${who}`}
                        value={String(m.button)}
                        onChange={(e) => setButton(i, { button: Number(e.target.value) })}
                      >
                        <option value="-1">None</option>
                        {optionsFor(buttons.length, m.button).map((n) => (
                          <option key={n} value={n}>
                            Button {n}
                          </option>
                        ))}
                      </LaSelect>
                      <LaButton
                        variant="ghost"
                        onClick={() =>
                          learn.start(`button${i}`, 'button', (button) => setButton(i, { button }))
                        }
                      >
                        {learnLabel(`button${i}`)}
                      </LaButton>
                    </div>
                    <LaSelect
                      aria-label={`What the button for ${who} does`}
                      value={m.mode}
                      onChange={(e) => {
                        const mode = e.target.value as ButtonMode
                        setButton(i, { mode, values: defaultValues(mode), flightMode: '' })
                      }}
                    >
                      {(Object.keys(MODE_LABELS) as ButtonMode[]).map((mode) => (
                        <option key={mode} value={mode}>
                          {MODE_LABELS[mode]}
                        </option>
                      ))}
                    </LaSelect>
                    {flightMode ? (
                      <FlightModeSelect
                        label={`Flight mode for ${who}`}
                        value={m.flightMode ?? ''}
                        onChange={(name) => setButton(i, { flightMode: name })}
                      />
                    ) : (
                      <div className="js-grid__value">
                        <ValuesInput
                          label={`Values in microseconds for ${who}`}
                          values={m.values}
                          count={m.mode === 'set' ? 1 : 2}
                          onChange={(values) => setButton(i, { values })}
                        />
                        <span className="la-field__unit">µs</span>
                      </div>
                    )}
                    <span className="js-grid__num">
                      {flightMode ? '—' : live(channels[m.channel - 1], m.button >= 0)}
                    </span>
                    <RemoveButton
                      label={`Remove the mapping for ${who}`}
                      onClick={() =>
                        setConfig({ buttons: now().buttons.filter((_, j) => j !== i) })
                      }
                    />
                  </div>
                )
              })}
            </div>
            <LaButton
              variant="ghost"
              onClick={() =>
                setConfig({
                  buttons: [
                    ...now().buttons,
                    {
                      channel: nextFreeChannel(now()),
                      button: -1,
                      mode: 'toggle',
                      values: defaultValues('toggle'),
                    },
                  ],
                })
              }
            >
              Add button
            </LaButton>
          </section>

          {/* One line, and only when there is something to fix. */}
          {conflicts.length > 0 && (
            <LaHint error>
              {conflicts.length === 1
                ? `${channelName(conflicts[0]!)} is driven by two mappings; the last one wins.`
                : `Channels ${conflicts.join(', ')} are each driven by two mappings.`}
            </LaHint>
          )}
        </div>
      </LaModal>

      {/* After the settings dialog, so it draws over it. */}
      <LaModal
        open={replacing !== null}
        narrow
        title={`Replace ${replacing?.name ?? ''}?`}
        actions={
          <div className="la-prompt-actions">
            <LaButton
              variant="primary"
              size="block"
              onClick={() => {
                if (replacing) keepOpened(replacing.name, replacing.config)
                setReplacing(null)
              }}
            >
              Replace profile
            </LaButton>
            <LaButton variant="ghost" size="block" onClick={() => setReplacing(null)}>
              Cancel
            </LaButton>
          </div>
        }
      >
        <p>A different profile with this name is already saved.</p>
      </LaModal>
    </>
  )
}

/**
 * Named profiles, and the same profiles as files: load one onto this device,
 * save this one under a name, delete one, or move one between machines. One
 * row, because they are one subject -- the file buttons once sat in the
 * dialog's footer and read as a second, unrelated way of saving.
 */
function Profiles({
  picked,
  onPick,
  note,
  onNote,
  onSaveToFile,
  onOpenFromFile,
}: {
  picked: string
  onPick: (name: string) => void
  note: Note
  onNote: (note: Note) => void
  onSaveToFile: () => void
  onOpenFromFile: (f: File) => void
}) {
  const file = useRef<HTMLInputElement>(null)
  const profiles = useJoystickStore((s) => s.profiles)
  const save = useJoystickStore((s) => s.saveProfile)
  const load = useJoystickStore((s) => s.loadProfile)
  const remove = useJoystickStore((s) => s.deleteProfile)
  const names = Object.keys(profiles).sort((a, b) => a.localeCompare(b))
  const [naming, setNaming] = useState<string | null>(null)

  const saveAs = (name: string) => {
    save(name)
    onPick(name)
    onNote({ text: `Saved ${name}` })
    setNaming(null)
  }

  return (
    <section className="js-setup__group">
      {/* The result of a load or a save goes beside the heading: a slot that
          is always there, where the row itself has no room left. */}
      <div className="js-setup__headrow">
        <h4 className="js-setup__head">Profile</h4>
        <span className={`js-profiles__note${note?.bad ? ' is-bad' : ''}`} role="status">
          {/* A space when empty, so the slot is a line tall either way: empty,
              it had no height, and a note appearing pushed the dialog down. */}
          {note ? note.text : <>&nbsp;</>}
        </span>
      </div>
      <div className="js-profiles">
        {naming === null ? (
          <>
            <LaSelect
              aria-label="Saved profiles"
              value={picked}
              onChange={(e) => onPick(e.target.value)}
            >
              <option value="">{names.length ? 'Choose a profile' : 'No saved profiles'}</option>
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </LaSelect>
            <LaButton
              variant="secondary"
              disabled={!picked}
              onClick={() => {
                load(picked)
                onNote({ text: `Loaded ${picked}` })
              }}
            >
              Load
            </LaButton>
            <LaButton variant="ghost" onClick={() => setNaming(picked)}>
              Save as
            </LaButton>
            <LaButton
              variant="ghost"
              disabled={!picked}
              onClick={() => {
                remove(picked)
                onPick('')
              }}
            >
              Delete
            </LaButton>
            <LaButton variant="ghost" onClick={() => file.current?.click()}>
              Import
            </LaButton>
            <LaButton variant="ghost" onClick={onSaveToFile}>
              Export
            </LaButton>
          </>
        ) : (
          // Naming happens in the row it was asked from, so the dialog does
          // not grow a line for it: the box where the list was, and two of
          // the three buttons' places.
          <>
            <LaInput
              aria-label="Profile name"
              autoFocus
              value={naming}
              placeholder="Profile name"
              onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && naming.trim()) saveAs(naming.trim())
                if (e.key === 'Escape') setNaming(null)
              }}
            />
            <LaButton
              variant="secondary"
              disabled={!naming.trim()}
              onClick={() => saveAs(naming.trim())}
            >
              Save
            </LaButton>
            <LaButton variant="ghost" onClick={() => setNaming(null)}>
              Cancel
            </LaButton>
          </>
        )}
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) onOpenFromFile(f)
          }}
        />
      </div>
    </section>
  )
}

function ChannelSelect({ value, onChange }: { value: number; onChange: (ch: number) => void }) {
  return (
    <LaSelect
      aria-label="Channel"
      value={String(value)}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {Array.from({ length: CHANNELS }, (_, i) => i + 1).map((ch) => (
        <option key={ch} value={ch}>
          {ch} · {channelName(ch).replace(/^Ch \d+$/, 'Aux')}
        </option>
      ))}
    </LaSelect>
  )
}

/**
 * A button's values as one line of microseconds: two for momentary and
 * toggle, one for set. Edited as text and taken on blur or Enter, so typing
 * "1500" does not pass through 1, 15 and 150. A value outside what a servo
 * can be sent is dropped, and a line left short goes back to what it was.
 */
function ValuesInput({
  label,
  values,
  count,
  onChange,
}: {
  label: string
  values: number[]
  count: 1 | 2
  onChange: (v: number[]) => void
}) {
  const [text, setText] = useState(values.join(', '))
  useEffect(() => setText(values.join(', ')), [values])
  const commit = () => {
    const parsed = text
      .split(/[,\s]+/)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n >= PWM_LIMIT_MIN && n <= PWM_LIMIT_MAX)
    if (parsed.length >= count) onChange(parsed.slice(0, count))
    else setText(values.join(', '))
  }
  return (
    <LaInput
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}

/**
 * The flight modes to choose from: the connected vehicle's, since those are
 * the ones a press can reach; with none connected, every name any ArduPilot
 * vehicle has. A saved name the list lacks is kept and shown, so a profile
 * made for another vehicle reads back as it was written.
 */
function FlightModeSelect({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (name: string) => void
}) {
  const vehicleType = useVehicleStore((s) => (s.present ? s.vehicleType : 0))
  const own = Object.values(modeTable(vehicleType))
  const names = [
    ...new Set([
      ...(own.length > 0 ? own : ANY_VEHICLE.flatMap((t) => Object.values(modeTable(t)))),
      ...(value ? [value] : []),
    ]),
  ].sort((a, b) => a.localeCompare(b))
  return (
    <LaSelect aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a mode</option>
      {names.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </LaSelect>
  )
}

/** A MAV_TYPE of each vehicle family with a mode table: copter, plane, rover. */
const ANY_VEHICLE = [2, 1, 10]

/** The remove mark the app's other lists use (fences, rally points, plotted fields). */
function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="fence-item__x"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      ✕
    </button>
  )
}

/** Choices for an axis or button list: what the device reports, plus the current pick. */
function optionsFor(count: number, current: number): number[] {
  const n = Math.max(count, current + 1, 0)
  return Array.from({ length: n }, (_, i) => i)
}

/** A channel's value as sent, or a dash where nothing drives it. */
function live(value: number | undefined, mapped: boolean): string {
  if (!mapped || value === undefined || value === 0 || value >= 65534) return '—'
  return String(value)
}
