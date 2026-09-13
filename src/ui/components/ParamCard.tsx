import type { ReactNode } from 'react'
import { LaCard } from './La'
import ParamField from './ParamField'
import SetupBand from './SetupBand'
import { useInDoc } from './SetupDoc'
import { useParamStore } from '../../stores/param-store'

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
}

export default function ParamCard({
  title,
  subtitle,
  note,
  fields,
  children,
  className,
}: {
  title: string
  subtitle?: string
  note?: string
  fields: ParamFieldSpec[]
  children?: ReactNode
  className?: string
}) {
  const entries = useParamStore((s) => s.entries)
  const inDoc = useInDoc()
  const present = fields.filter((f) => entries.has(f.param))
  if (present.length === 0 && !children) return null

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
    >
      {controls}
    </LaCard>
  )
}

/** Shared empty state for a tab that needs a connected vehicle. */
export function NeedsVehicle({ title, body }: { title: string; body: string }) {
  return (
    <LaCard title={title} note="Connect a vehicle to see its settings.">
      <p className="app-placeholder">{body}</p>
    </LaCard>
  )
}
