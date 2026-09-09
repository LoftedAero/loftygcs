import { createContext, useContext, type ReactNode } from 'react'

// A setup tab drawn as one document rather than as a tray of cards.
//
// The tiled grid gives every group the same box, and on a wide window that
// box is mostly padding: a three-field group in a 1,050 px column puts its
// controls in the left 450 and leaves the rest empty. A document spends the
// width the other way -- one surface, a band per group, and the fields
// flowing across the band four at a time -- so a wider window shows more
// fields per row instead of wider empty boxes.
//
// It is a *context* rather than a prop so a tab converts by being wrapped
// and reverts by being unwrapped, with its declaration untouched. The
// alternative was a `band` prop threaded through every ParamCard in every
// tab, which makes trying the idea cost more than the idea is worth.
//
// Only the curated parameter tabs can be wrapped: a tab with its own
// layout (Ports, Outputs, Radio, OSD) is not a stack of groups and has
// nothing to band.

const InDoc = createContext(false)

/** True when this group is being drawn inside a document rather than a card. */
export function useInDoc(): boolean {
  return useContext(InDoc)
}

export default function SetupDoc({ children }: { children: ReactNode }) {
  return (
    <InDoc.Provider value={true}>
      <div className="app-doc">{children}</div>
    </InDoc.Provider>
  )
}
