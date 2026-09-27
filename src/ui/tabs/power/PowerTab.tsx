import { useState } from 'react'
import { LaCard, LaReadout } from '../../components/La'
import ParamCard, { NeedsVehicle, type ParamFieldSpec } from '../../components/ParamCard'
import CardParamActions from '../../components/CardParamActions'
import SubTabs from '../../components/SubTabs'
import { useConnectionStore } from '../../../stores/connection-store'
import { useParamStore } from '../../../stores/param-store'
import { useVehicleStore } from '../../../stores/vehicle-store'

// Battery monitoring: sensor setup, live reading and failsafe action for the
// battery the switch shows. BATT_* is one library, so Copter, Plane and a
// quadplane report the same set (Plane's extra BATT_WATT_MAX is left to the
// Parameters table).
//
// Units come from the parameter metadata; VOLT_MULT, the one without, is a
// ratio.
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

// Every monitor is the same parameter group under its own prefix (BATT_,
// BATT2_ through BATT9_), so one declaration serves each. The switch offers a
// fixed two so tabs do not appear and move as monitors are enabled; further
// packs are edited in the Parameters table.
type Battery = '1' | '2'
const BATTERIES = [
  { id: '1', label: 'Battery 1' },
  { id: '2', label: 'Battery 2' },
] as const
const prefix = (b: Battery) => (b === '1' ? 'BATT' : `BATT${b}`)

// MONITOR gates the rest of the group: at 0 nothing else under the prefix is
// reported, and setting it exposes the group without a restart. So it writes
// on change and re-reads. The other rows are reserved so the cards keep one
// height. Pins and scaling exist only for an analog backend, after a restart;
// for SMBus or DroneCAN monitors those rows stay grayed.
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

// Low and critical stages, each triggered by either a voltage or a capacity.
// The arming minimums sit with the thresholds they are compared against.
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
  // A switched-off battery still reports its monitor type, so this tells
  // whether the firmware has the battery at all.
  const exists = useParamStore((s) => s.entries.has(`${prefix(battery)}_MONITOR`))
  if (!connected || !ready) {
    return <NeedsVehicle title="Power" />
  }
  // The live reading sits above the monitor settings because the multiplier
  // is adjusted until the reading matches a meter. The switch, not the card
  // titles, names the battery.
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

// The first battery reads SYS_STATUS, as the app bar and HUD do. Others come
// from their own BATTERY_STATUS instance.
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
      {/* A dash for any missing reading. */}
      <LiveRow label="Voltage" unit="V" value={v > 0 ? v.toFixed(2) : undefined} />
      <LiveRow label="Current" unit="A" value={a >= 0 ? a.toFixed(1) : undefined} />
      <LiveRow label="Remaining" unit="%" value={pct >= 0 ? String(pct) : undefined} />
    </LaCard>
  )
}

// The parameter cards' named-row layout with an empty name column, so values
// and units line up with the controls on the page.
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
