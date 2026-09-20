import { LaCard, LaField, LaReadout } from '../../components/La'
import ParamCard, { NeedsVehicle } from '../../components/ParamCard'
import { useConnectionStore } from '../../../stores/connection-store'
import { useVehicleStore } from '../../../stores/vehicle-store'

// Battery monitoring: the sensor setup, its live reading, and the action the
// vehicle takes when the pack runs down. The live card is the calibration
// tool -- adjust the multiplier until the readout matches a meter.
export default function PowerTab() {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  if (!connected) {
    return (
      <NeedsVehicle title="Power" />
    )
  }
  return (
    <>
      <LiveCard />
      <ParamCard
        title="Battery monitor"
        fields={[
          { param: 'BATT_MONITOR', label: 'Monitor type' },
          { param: 'BATT_CAPACITY', label: 'Pack capacity', unit: 'mAh' },
          { param: 'BATT_VOLT_PIN', label: 'Voltage pin' },
          { param: 'BATT_CURR_PIN', label: 'Current pin' },
          { param: 'BATT_VOLT_MULT', label: 'Voltage multiplier' },
          { param: 'BATT_AMP_PERVLT', label: 'Amps per volt' },
          { param: 'BATT_AMP_OFFSET', label: 'Current offset', unit: 'V' },
        ]}
      />
      <ParamCard
        title="Low battery"
        note="Set them from a real flight log, not a bench reading."
        fields={[
          { param: 'BATT_LOW_VOLT', label: 'Low voltage', unit: 'V' },
          { param: 'BATT_LOW_MAH', label: 'Low capacity', unit: 'mAh' },
          { param: 'BATT_FS_LOW_ACT', label: 'Low action' },
          { param: 'BATT_CRT_VOLT', label: 'Critical voltage', unit: 'V' },
          { param: 'BATT_CRT_MAH', label: 'Critical capacity', unit: 'mAh' },
          { param: 'BATT_FS_CRT_ACT', label: 'Critical action' },
          { param: 'BATT_LOW_TIMER', label: 'Trigger delay', unit: 's' },
        ]}
      />
      <ParamCard
        title="Second battery"
        fields={[
          { param: 'BATT2_MONITOR', label: 'Monitor type' },
          { param: 'BATT2_CAPACITY', label: 'Pack capacity', unit: 'mAh' },
          { param: 'BATT2_LOW_VOLT', label: 'Low voltage', unit: 'V' },
        ]}
      />
    </>
  )
}

function LiveCard() {
  const v = useVehicleStore((s) => s.batteryV)
  const a = useVehicleStore((s) => s.batteryA)
  const pct = useVehicleStore((s) => s.batteryPct)
  return (
    // This card is the calibration tool -- the multiplier on the card below
    // is turned until this readout matches a meter -- which the numbers show
    // without a sentence saying so.
    <LaCard title="Live reading">
      <LaField label="Voltage" unit="V">
        <LaReadout placeholder="—" value={v > 0 ? v.toFixed(2) : undefined} />
      </LaField>
      <LaField label="Current" unit="A">
        {/* A dash, like its neighbours: the three readouts are one set, and
            empty is empty whichever reading is missing. */}
        <LaReadout placeholder="—" value={a >= 0 ? a.toFixed(1) : undefined} />
      </LaField>
      <LaField label="Remaining" unit="%">
        <LaReadout placeholder="—" value={pct >= 0 ? String(pct) : undefined} />
      </LaField>
    </LaCard>
  )
}
