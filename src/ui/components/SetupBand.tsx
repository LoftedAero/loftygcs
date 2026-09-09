import type { ReactNode } from 'react'

// One group inside a SetupDoc: the same thing a card is, without the box.
//
// The heading carries the orange rule a card's title carries, because in a
// document that rule is the only thing separating one group from the next --
// it is doing more work here than it does on a card, not less. It is mixed
// back toward the surface because a card shows one and a document shows six,
// and six full-strength rules read as a warning rather than as structure.
export default function SetupBand({
  title,
  tag,
  note,
  children,
}: {
  title: string
  /** The card's subtitle -- "Copter", "Plane" -- beside the heading here. */
  tag?: string
  note?: string
  children: ReactNode
}) {
  return (
    <section className="app-band">
      <div className="app-band__head">
        <h3 className="app-band__title">{title}</h3>
        {tag && <span className="app-band__tag">{tag}</span>}
      </div>
      {children}
      {note && <p className="la-card__note">{note}</p>}
    </section>
  )
}
