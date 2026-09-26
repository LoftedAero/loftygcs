import type { ReactNode } from 'react'
import { LaCard } from './La'
import ParamField from './ParamField'
import SetupBand from './SetupBand'
import { useInDoc } from './SetupDoc'
import { useParamStore } from '../../stores/param-store'
import { useConnectionStore } from '../../stores/connection-store'

// A card built from a list of parameters. Fields the connected vehicle does
// not have are dropped, and a card left with nothing to show hides itself --
// so one declaration serves Copter, Plane, and Rover without per-vehicle
// branching in every tab.
export interface ParamFieldSpec {
  param: string
  label: string
  unit?: string
  /**
   * Send this one as soon as it is chosen, instead of staging it.
   *
   * Only for a parameter that gates others -- see ParamField. A curated card
   * is a declaration, so this stays a field on the declaration rather than a
   * second kind of card.
   */
  writeNow?: boolean
  /** Also re-read the set afterwards -- see ParamField. */
  gatesOthers?: boolean
  /** Greyed until whatever it depends on is switched on -- see ParamField. */
  disabled?: boolean
  /** A number box even where ArduPilot names some values -- see ParamField. */
  numeric?: boolean
  /** Each named value's number beside its name -- see ParamField. */
  withValues?: boolean
  /** Short names for a dropdown's values -- see ParamField. */
  optionLabels?: Record<number, string>
  /**
   * Drawn, greyed, even while the vehicle does not report it, instead of
   * dropped. For a parameter the firmware creates only once something else is
   * switched on and the vehicle restarts -- the harmonic notch's settings
   * after INS_HNTCH_ENABLE -- so the card is one height before and after, as
   * the VTOL frame rows are on Configuration.
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
  /**
   * What the card does, on its title row -- usually `CardParamActions`.
   *
   * Card layout only: the guided-document layout below puts a band's heading
   * and its fields in one flow, with nowhere for a button to sit.
   */
  actions?: ReactNode
  /**
   * Print each parameter's ArduPilot name under its label.
   *
   * A card-level switch rather than a flag per field: within one card the
   * answer is always the same, and a list where some rows carried a name and
   * others did not would read as the name meaning something.
   */
  showNames?: boolean
  /**
   * Values in their compact form, for a card too narrow for ArduPilot's own:
   * a bitmask as "2 selected", a sentence-length dropdown value by its short
   * name (`option-names.ts`), the full text on hover. Card-level for the same
   * reason `showNames` is.
   */
  compact?: boolean
  /**
   * Draw the card even when every row is reserved. For a feature the firmware
   * has but is switched off -- a second battery whose BATT2_MONITOR is 0
   * reports nothing else, so its failsafe card would vanish from beside the
   * monitor card that switches it on. The caller decides from a parameter
   * that says the feature exists; a firmware without it still gets no card.
   */
  drawn?: boolean
}) {
  const entries = useParamStore((s) => s.entries)
  const inDoc = useInDoc()
  const present = fields.filter((f) => entries.has(f.param) || f.reserve)
  // Reserved rows hold a card's shape; they are not a reason to draw it. A
  // firmware with none of the real ones gets no card, not a card of greyed rows
  // -- unless the caller knows the feature is there and merely switched off.
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

  // Inside a document the same declaration becomes a band: the fields flow
  // across the width instead of down a column, so nothing about the tab
  // changes except the shape it is poured into.
  if (inDoc) {
    return (
      <SetupBand
        title={title}
        {...(subtitle !== undefined ? { tag: subtitle } : {})}
        {...(note !== undefined ? { note } : {})}
      >
        <div className="app-band__fields">{controls}</div>
      </SetupBand>
    )
  }

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
 * Shared empty state for a tab that needs a connected vehicle: the tab's name
 * and one line saying why it is empty.
 *
 * Two states, because there are two reasons to be here and only one of them
 * is the user's to act on. With nothing connected this is barely seen at all
 * -- a vehicle-only tab leaves the rail on a disconnect, and this covers the
 * one render before the redirect, which is the defence Mission Planner keeps
 * its own "not connected" messages as.
 *
 * A **reboot** is the other, and it is seen for seconds rather than a frame:
 * the tab deliberately stays put so the screen that asked for the restart is
 * the screen you come back to. "Connect a vehicle" is wrong there -- nobody
 * has to do anything, the link comes back by itself -- so the card says what
 * is happening instead.
 *
 * Neither state describes the tab. Each one carried a sentence naming what the
 * screen would have held, which is the card-that-describes-itself this app
 * removed from eleven tabs already; the rail says where you are.
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
