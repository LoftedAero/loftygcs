import { LaButton, LaField, LaHint, LaModal, LaSelect } from '../components/La'
import { useUiStore } from '../../stores/ui-store'
import { usePreferencesStore } from '../../stores/preferences-store'
import { useThemeStore, type ThemeChoice } from '../../stores/theme-store'
import {
  DISTANCE_CHOICES,
  SPEED_CHOICES,
  VERTICAL_SPEED_CHOICES,
  verticalSpeedLabel,
} from '../../units'
import type { DistanceUnit, SpeedUnit, VerticalSpeedUnit } from '../../units'

// Everything about the person rather than the aircraft.
//
// A dialog and not a rail tab on purpose: the rail is the bring-up sequence
// for a vehicle, and these settings outlive any vehicle and apply from every
// mode. It is sectioned rather than a flat list of controls because the next
// things to land here -- language, and whatever follows -- are sections too,
// and a list that grows into groups later reorganizes under the user.

const THEME_CHOICES: { id: ThemeChoice; label: string }[] = [
  { id: 'system', label: 'Match the system' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

export default function PreferencesModal() {
  const open = useUiStore((s) => s.preferencesOpen)
  const setOpen = useUiStore((s) => s.setPreferencesOpen)
  const units = usePreferencesStore((s) => s.units)
  const setDistanceUnit = usePreferencesStore((s) => s.setDistanceUnit)
  const setSpeedUnit = usePreferencesStore((s) => s.setSpeedUnit)
  const setVerticalSpeedUnit = usePreferencesStore((s) => s.setVerticalSpeedUnit)
  const reset = usePreferencesStore((s) => s.reset)
  const themeChoice = useThemeStore((s) => s.choice)
  const setThemeChoice = useThemeStore((s) => s.setChoice)

  return (
    <LaModal
      open={open}
      title="Preferences"
      actions={
        <>
          <LaButton variant="ghost" onClick={reset}>
            Reset to defaults
          </LaButton>
          <LaButton variant="primary" onClick={() => setOpen(false)}>
            Done
          </LaButton>
        </>
      }
    >
      <section className="prefs__group">
        <h3 className="prefs__head">Units</h3>
        <LaField label="Distance and altitude" htmlFor="pref-distance">
          <LaSelect
            id="pref-distance"
            value={units.distance}
            onChange={(e) => setDistanceUnit(e.target.value as DistanceUnit)}
          >
            {DISTANCE_CHOICES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </LaSelect>
        </LaField>
        <LaField label="Speed" htmlFor="pref-speed">
          <LaSelect
            id="pref-speed"
            value={units.speed}
            onChange={(e) => setSpeedUnit(e.target.value as SpeedUnit)}
          >
            {SPEED_CHOICES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </LaSelect>
        </LaField>
        <LaField label="Climb rate" htmlFor="pref-vspeed">
          <LaSelect
            id="pref-vspeed"
            value={units.verticalSpeed}
            onChange={(e) => setVerticalSpeedUnit(e.target.value as VerticalSpeedUnit)}
          >
            {VERTICAL_SPEED_CHOICES.map((c) => (
              <option key={c.id} value={c.id}>
                {/* The default says what it currently resolves to, so
                    "Follow distance" is not a thing to work out. */}
                {c.id === 'follow' ? `${c.label} (${verticalSpeedLabel(units)})` : c.label}
              </option>
            ))}
          </LaSelect>
        </LaField>
        <LaHint>Display units only — the vehicle is always commanded in SI</LaHint>
      </section>

      <section className="prefs__group">
        <h3 className="prefs__head">Appearance</h3>
        <LaField label="Theme" htmlFor="pref-theme">
          <LaSelect
            id="pref-theme"
            value={themeChoice}
            onChange={(e) => setThemeChoice(e.target.value as ThemeChoice)}
          >
            {THEME_CHOICES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </LaSelect>
        </LaField>
      </section>
    </LaModal>
  )
}
