import type { ReactNode } from 'react'
import { LaCard } from './La'
import ParamField from './ParamField'
import { useParamStore } from '../../stores/param-store'

// A card built from a list of parameters. Fields the connected vehicle does
// not have are dropped, and a card left with nothing to show hides itself --
// so one declaration serves Copter, Plane, and Rover without per-vehicle
// branching in every tab.
export interface ParamFieldSpec {
  param: string
  label: string
  unit?: string
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
  const present = fields.filter((f) => entries.has(f.param))
  if (present.length === 0 && !children) return null
  return (
    <LaCard
      title={title}
      {...(subtitle !== undefined ? { subtitle } : {})}
      {...(note !== undefined ? { note } : {})}
      {...(className !== undefined ? { className } : {})}
    >
      {present.map((f) => (
        <ParamField key={f.param} param={f.param} label={f.label} {...(f.unit ? { unit: f.unit } : {})} />
      ))}
      {children}
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
