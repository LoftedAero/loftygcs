import type { ReactNode } from 'react'
import { LaCard } from './La'
import ParamField from './ParamField'
import { useParamStore } from '../../stores/param-store'
import { useConnectionStore } from '../../stores/connection-store'

// A card built from a list of parameters. Fields the connected vehicle does
// not have are dropped, and a card left with nothing to show hides itself, so
// one declaration serves Copter, Plane and Rover.
export interface ParamFieldSpec {
  param: string
  label: string
  unit?: string
  /** Send as soon as chosen instead of staging, for a parameter that gates others. */
  writeNow?: boolean
  /** Also re-read the set afterwards; see ParamField. */
  gatesOthers?: boolean
  /** Grayed until whatever it depends on is switched on; see ParamField. */
  disabled?: boolean
  /** A number box even where ArduPilot names some values; see ParamField. */
  numeric?: boolean
  /** Each named value's number beside its name; see ParamField. */
  withValues?: boolean
  /** Short names for a dropdown's values; see ParamField. */
  optionLabels?: Record<number, string>
  /**
   * Drawn grayed while the vehicle does not report it, instead of dropped.
   * For a parameter the firmware creates only after something else is
   * enabled and the vehicle restarts (the harmonic notch settings after
   * INS_HNTCH_ENABLE), so the card keeps one height.
   */
  reserve?: boolean
}

export default function ParamCard({
  title,
  subtitle,
  note,
  fields,
  children,
  className,
  actions,
  showNames,
  compact,
  drawn,
}: {
  title: string
  subtitle?: string
  note?: string
  fields: ParamFieldSpec[]
  children?: ReactNode
  className?: string
  /** Actions on the title row, usually `CardParamActions`. */
  actions?: ReactNode
  /** Print each parameter's ArduPilot name under its label, for the whole card. */
  showNames?: boolean
  /**
   * Compact values for a narrow card: a bitmask as "2 selected", a long
   * dropdown value by its short name (`option-names.ts`), full text on hover.
   */
  compact?: boolean
  /**
   * Draw the card even when every row is reserved, for a feature the firmware
   * has but is switched off (a second battery with BATT2_MONITOR 0 reports
   * nothing else). The caller decides from a parameter that says the feature
   * exists.
   */
  drawn?: boolean
}) {
  const entries = useParamStore((s) => s.entries)
  const present = fields.filter((f) => entries.has(f.param) || f.reserve)
  // Reserved rows alone are not a reason to draw the card, unless the caller
  // says the feature exists (`drawn`).
  if (!fields.some((f) => entries.has(f.param)) && !children && !drawn) return null

  const controls = (
    <>
      {present.map((f) => (
        <ParamField
          key={f.param}
          param={f.param}
          label={f.label}
          {...(f.unit ? { unit: f.unit } : {})}
          {...(f.writeNow ? { writeNow: true } : {})}
          {...(f.gatesOthers ? { gatesOthers: true } : {})}
          {...(showNames ? { showName: true } : {})}
          {...(f.disabled || (f.reserve && !entries.has(f.param)) ? { disabled: true } : {})}
          {...(f.numeric ? { numeric: true } : {})}
          {...(f.withValues ? { withValues: true } : {})}
          {...(f.optionLabels ? { optionLabels: f.optionLabels } : {})}
          {...(compact ? { bitmaskCount: true, shortOptions: true } : {})}
        />
      ))}
      {children}
    </>
  )

  return (
    <LaCard
      title={title}
      {...(subtitle !== undefined ? { subtitle } : {})}
      {...(note !== undefined ? { note } : {})}
      {...(className !== undefined ? { className } : {})}
      {...(actions !== undefined ? { actions } : {})}
    >
      {controls}
    </LaCard>
  )
}

/**
 * Shared empty state for a tab that needs a connected vehicle.
 *
 * Disconnected, it is seen for one render before the rail redirects away
 * from a vehicle-only tab. During a reboot the tab stays put and this is seen
 * for seconds, so it says what is happening rather than "connect a vehicle".
 */
export function NeedsVehicle({ title }: { title: string }) {
  const rebooting = useConnectionStore((s) => s.phase === 'rebooting')
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const loading = useParamStore((s) => s.loadState !== 'ready')
  const note = rebooting
    ? 'Rebooting the vehicle and reconnecting telemetry.'
    : connected && loading
      ? 'Reading the vehicle’s parameters.'
      : 'Connect a vehicle to see its settings.'
  return <LaCard title={title} note={note} />
}
