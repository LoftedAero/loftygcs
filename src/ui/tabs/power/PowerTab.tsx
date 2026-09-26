import { useState } from 'react'
import { LaCard, LaReadout } from '../../components/La'
import ParamCard, { NeedsVehicle, type ParamFieldSpec } from '../../components/ParamCard'
import CardParamActions from '../../components/CardParamActions'
import SubTabs from '../../components/SubTabs'
import { useConnectionStore } from '../../../stores/connection-store'
import { useParamStore } from '../../../stores/param-store'
import { useVehicleStore } from '../../../stores/vehicle-store'

// Battery monitoring: the sensor setup, its live reading, and the action the
// vehicle takes when the pack runs down, for whichever battery the switch
// shows. The same three cards on every vehicle and for every battery
// -- BATT_* is one library, and Copter, Plane and a quadplane report the same
// set (Plane adds BATT_WATT_MAX, which is left to the Parameters table rather
// than drawn on one vehicle out of three).
//
// **No unit is written here.** Every BATT_* the metadata gives a unit carries
// it, so the page is right for whatever a release says; the one without,
// VOLT_MULT, is a ratio.
const REASON = 'Battery changes take effect after a restart'

function card(title: string, fields: ParamFieldSpec[], exists: boolean) {
  const names = new Set(fields.map((f) => f.param))
  return (
    <ParamCard
      title={title}
      showNames
      compact
      drawn={exists}
      fields={fields}
      actions={<CardParamActions reason={REASON} owns={(p) => names.has(p)} />}
    />
  )
}

// Every monitor is the same parameter group under its own prefix -- BATT_,
// BATT2_ and on to BATT9_ -- so one declaration serves each, and a second
// battery gets exactly what the first does rather than a short list of its
// own. Two are offered: the switch is a fixed set, because tabs that appear as
// monitors are switched on would move under the pointer, and past a second
// pack the Parameters table is the honest place.
type Battery = '1' | '2'
const BATTERIES = [
  { id: '1', label: 'Battery 1' },
  { id: '2', label: 'Battery 2' },
] as const
const prefix = (b: Battery) => (b === '1' ? 'BATT' : `BATT${b}`)

// MONITOR gates the rest of the group: at 0 the vehicle reports nothing else
// under that prefix, and setting it exposes the group live, no restart --
// measured against SITL on BATT2_, thirteen parameters appear. So it writes on
// change and re-reads, the way Q_ENABLE and the notch enables do. Everything
// else is reserved, so the cards are one height whichever battery is showing
// and whatever it is set to. The pins and scaling exist only for an analog
// backend, and only after the restart the new type asks for: an SMBus or
// DroneCAN monitor has none, and those rows stay greyed.
function monitorFields(b: Battery): ParamFieldSpec[] {
  const p = prefix(b)
  return [
    { param: `${p}_MONITOR`, label: 'Monitor', writeNow: true, gatesOthers: true },
    { param: `${p}_CAPACITY`, label: 'Capacity', reserve: true },
    { param: `${p}_VOLT_PIN`, label: 'Voltage pin', reserve: true },
    { param: `${p}_CURR_PIN`, label: 'Current pin', reserve: true },
    { param: `${p}_VOLT_MULT`, label: 'Voltage multiplier', reserve: true },
    { param: `${p}_AMP_PERVLT`, label: 'Amps per volt', reserve: true },
    { param: `${p}_AMP_OFFSET`, label: 'Current offset', reserve: true },
    { param: `${p}_VLT_OFFSET`, label: 'Voltage offset', reserve: true },
    { param: `${p}_OPTIONS`, label: 'Options', reserve: true },
  ]
}

// Low and critical are the two stages, each a voltage and a capacity, either
// of which triggers it. Set from a real flight log rather than a bench
// reading: a pack under load sags well below where it rests, and a threshold
// chosen on the bench fires on the first climb. The arming minimums are the
// same question asked before takeoff instead of during the flight, so they
// sit with the thresholds they are measured against.
function failsafeFields(b: Battery): ParamFieldSpec[] {
  const p = prefix(b)
  return [
    { param: `${p}_LOW_VOLT`, label: 'Low voltage', reserve: true },
    { param: `${p}_LOW_MAH`, label: 'Low capacity', reserve: true },
    { param: `${p}_FS_LOW_ACT`, label: 'Low action', reserve: true },
    { param: `${p}_CRT_VOLT`, label: 'Critical voltage', reserve: true },
    { param: `${p}_CRT_MAH`, label: 'Critical capacity', reserve: true },
    { param: `${p}_FS_CRT_ACT`, label: 'Critical action', reserve: true },
    { param: `${p}_ARM_VOLT`, label: 'Arming voltage', reserve: true },
    { param: `${p}_ARM_MAH`, label: 'Arming capacity', reserve: true },
    { param: `${p}_LOW_TIMER`, label: 'Trigger delay', reserve: true },
    { param: `${p}_FS_VOLTSRC`, label: 'Voltage source', reserve: true },
  ]
}

export default function PowerTab() {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const ready = useParamStore((s) => s.loadState === 'ready')
  const [battery, setBattery] = useState<Battery>('1')
  // The monitor type is the one row a switched-off battery still reports, so
  // it is what says the firmware has this battery at all.
  const exists = useParamStore((s) => s.entries.has(`${prefix(battery)}_MONITOR`))
  if (!connected || !ready) {
    return <NeedsVehicle title="Power" />
  }
  // The reading over the monitor settings, because that is how they are set:
  // the multiplier is turned until the readout matches a meter. The failsafe
  // beside them. Titles do not say which battery -- the switch does, as the
  // quadplane's VTOL view on Tuning carries no prefix either.
  return (
    <>
      <SubTabs tabs={BATTERIES} active={battery} onChange={setBattery} label="Battery" />
      <div className="config-screen config-screen--even">
        <div className="app-stack app-stack--fill">
          <LiveCard battery={battery} />
          {card('Battery monitor', monitorFields(battery), exists)}
        </div>
        <div className="app-stack app-stack--fill">
          {card('Battery failsafe', failsafeFields(battery), exists)}
        </div>
      </div>
    </>
  )
}

// The first battery reads SYS_STATUS, which is what the app bar and the HUD
// show and what every vehicle sends, the demo one included. Any other comes
// only from its own BATTERY_STATUS, by instance.
function LiveCard({ battery }: { battery: Battery }) {
  const primary = useVehicleStore((s) => s.batteryV)
  const primaryA = useVehicleStore((s) => s.batteryA)
  const primaryPct = useVehicleStore((s) => s.batteryPct)
  const other = useVehicleStore((s) => s.batteries[Number(battery) - 1])
  const [v, a, pct] =
    battery === '1'
      ? [primary, primaryA, primaryPct]
      : [other?.voltageV ?? 0, other?.currentA ?? -1, other?.remainingPct ?? -1]
  return (
    <LaCard title="Live reading">
      {/* A dash when a reading is missing, whichever it is: the three are one
          set. */}
      <LiveRow label="Voltage" unit="V" value={v > 0 ? v.toFixed(2) : undefined} />
      <LiveRow label="Current" unit="A" value={a >= 0 ? a.toFixed(1) : undefined} />
      <LiveRow label="Remaining" unit="%" value={pct >= 0 ? String(pct) : undefined} />
    </LaCard>
  )
}

// The named-row shape the parameter cards beside it use, with the name column
// left empty -- a reading is not a parameter -- so its values and units land on
// the same lines as every control on the page.
function LiveRow({
  label,
  unit,
  value,
}: {
  label: string
  unit: string
  value?: string | undefined
}) {
  return (
    <div className="la-field la-field--named">
      <label className="la-field__label">{label}</label>
      <span className="la-field__param" />
      <LaReadout placeholder="—" value={value} />
      <span className="la-field__unit">{unit}</span>
    </div>
  )
}
