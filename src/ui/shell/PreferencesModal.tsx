import { LaButton, LaField, LaHint, LaModal, LaSelect } from '../components/La'
import { BRAND } from '../../brand'
import { useUiStore } from '../../stores/ui-store'
import { UI_SCALES, usePreferencesStore, type LayoutChoice } from '../../stores/preferences-store'
import { useThemeStore, type ThemeChoice } from '../../stores/theme-store'
import {
  DISTANCE_CHOICES,
  SPEED_CHOICES,
  VERTICAL_SPEED_CHOICES,
  verticalSpeedLabel,
} from '../../units'
import type { DistanceUnit, SpeedUnit, VerticalSpeedUnit } from '../../units'

// Settings about the user rather than the aircraft. A dialog rather than a
// rail tab because they apply in every mode and outlive any vehicle.
// Sectioned so later additions (language, for one) slot in as sections.

const LAYOUT_CHOICES: { id: LayoutChoice; label: string }[] = [
  { id: 'auto', label: 'Automatic' },
  { id: 'desktop', label: 'Desktop' },
  { id: 'compact', label: 'Compact' },
]

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
  const uiScale = usePreferencesStore((s) => s.uiScale)
  const setUiScale = usePreferencesStore((s) => s.setUiScale)
  const layout = usePreferencesStore((s) => s.layout)
  const setLayout = usePreferencesStore((s) => s.setLayout)
  // Only the desktop app can scale its own window; a browser has its zoom.
  const canScale = typeof window !== 'undefined' && !!window.loftgcs
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
                {/* The default shows the unit it currently resolves to. */}
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
        <LaField label="Layout" htmlFor="pref-layout">
          <LaSelect
            id="pref-layout"
            value={layout}
            onChange={(e) => setLayout(e.target.value as LayoutChoice)}
          >
            {LAYOUT_CHOICES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </LaSelect>
        </LaField>
        <LaField label="Scale" htmlFor="pref-scale">
          <LaSelect
            id="pref-scale"
            value={String(uiScale)}
            disabled={!canScale}
            onChange={(e) => setUiScale(Number(e.target.value))}
          >
            {UI_SCALES.map((s) => (
              <option key={s} value={s}>
                {Math.round(s * 100)}%
              </option>
            ))}
          </LaSelect>
        </LaField>
        {!canScale && <LaHint>Use the browser’s zoom</LaHint>}
      </section>
      {/* The footer shows these too, but compact mode has no footer. */}
      <p className="la-card__note prefs__version">
        {BRAND.name} v{__APP_VERSION__}
        {BRAND.preview && <span className="app-preview-chip">Preview</span>}
      </p>
    </LaModal>
  )
}
