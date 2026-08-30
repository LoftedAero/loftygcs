import { create } from 'zustand'

// How the Fly screen is arranged, following Mission Planner's shape: one
// panel pinned to the left at a fixed aspect ratio with the controls and
// messages filling the space beneath it, and the other panel taking the
// whole height on the right. Dragging the divider resizes the left column,
// which changes the fixed-aspect panel's height, which is what the stack
// below it grows or shrinks to absorb.
//
// Persisted, because a layout you have to rebuild every session is worse
// than not being able to change it at all.

const STORAGE_KEY = 'loftgcs.flight.layout'

export type FlightPanel = 'map' | 'hud'

/**
 * Width and height of the fixed-aspect panel, as a ratio.
 *
 * 4:3 is what Mission Planner uses and what analog video is. A digital HD
 * feed would want 16:9, so this is likely to become a setting once the HUD
 * has a video source to letterbox.
 */
export const PANEL_ASPECT = 4 / 3

export interface FlightLayoutState {
  /** Fraction of the width taken by the fixed-aspect column. */
  ratio: number
  /** Which panel is pinned left at a fixed aspect ratio. */
  aspectPanel: FlightPanel
  showMap: boolean
  showHud: boolean
  showMessages: boolean
  /** The plot strip above the map. */
  showPlot: boolean
  /** Which telemetry fields the plot is drawing. */
  plotFields: string[]
  /** Whether the lower pane shows messages or the telemetry field list. */
  logPane: 'messages' | 'status'
  /** The artificial horizon. Off leaves the background layer showing. */
  hudHorizon: boolean
  /** Overlay elements drawn on the HUD, so they can be turned off for video. */
  hudOverlays: boolean

  setRatio: (r: number) => void
  swap: () => void
  toggle: (key: 'showMap' | 'showHud' | 'showMessages' | 'showPlot' | 'hudHorizon' | 'hudOverlays') => void
  togglePlotField: (name: string) => void
  setLogPane: (pane: 'messages' | 'status') => void
  reset: () => void
}

/** The part of the layout that survives a reload. */
interface Persisted {
  ratio: number
  aspectPanel: FlightPanel
  showMap: boolean
  showHud: boolean
  showMessages: boolean
  showPlot: boolean
  plotFields: string[]
  logPane: 'messages' | 'status'
  hudHorizon: boolean
  hudOverlays: boolean
}

const DEFAULTS: Persisted = {
  // Narrower than an even split: at 4:3 the left panel gets tall quickly,
  // and the controls beneath it need room.
  ratio: 0.38,
  aspectPanel: 'hud',
  showMap: true,
  showHud: true,
  showMessages: true,
  showPlot: false,
  plotFields: [],
  logPane: 'messages',
  hudHorizon: true,
  hudOverlays: true,
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const saved = JSON.parse(raw) as Partial<Persisted>
    // Merged rather than trusted: a layout written by an older build must not
    // leave a panel undefined and blank half the screen.
    return {
      ...DEFAULTS,
      ...saved,
      ratio: clampRatio(typeof saved.ratio === 'number' ? saved.ratio : DEFAULTS.ratio),
    }
  } catch {
    return DEFAULTS
  }
}

function persist(state: Persisted) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Private windows etc.: the layout just won't survive the session.
  }
}

/** Keeps both columns usable however hard the divider is dragged. */
export function clampRatio(r: number): number {
  return Math.min(0.7, Math.max(0.2, r))
}

function snapshot(s: FlightLayoutState): Persisted {
  return {
    ratio: s.ratio,
    aspectPanel: s.aspectPanel,
    showMap: s.showMap,
    showHud: s.showHud,
    showMessages: s.showMessages,
    showPlot: s.showPlot,
    plotFields: s.plotFields,
    logPane: s.logPane,
    hudHorizon: s.hudHorizon,
    hudOverlays: s.hudOverlays,
  }
}

export const useFlightLayoutStore = create<FlightLayoutState>((set, get) => {
  const save = () => persist(snapshot(get()))
  return {
    ...load(),

    setRatio: (r) => {
      set({ ratio: clampRatio(r) })
      save()
    },
    swap: () => {
      set({ aspectPanel: get().aspectPanel === 'map' ? 'hud' : 'map' })
      save()
    },
    toggle: (key) => {
      const next = !get()[key]
      // Never hide both panels: the result is an empty screen with no way
      // back except the toggles the user just used.
      if (!next && key === 'showMap' && !get().showHud) return
      if (!next && key === 'showHud' && !get().showMap) return
      set({ [key]: next } as Pick<FlightLayoutState, typeof key>)
      save()
    },
    togglePlotField: (name) => {
      const current = get().plotFields
      const next = current.includes(name)
        ? current.filter((f) => f !== name)
        : [...current, name]
      // Adding the first field is always meant to show the plot; nobody picks
      // a field in order to look at a panel that is switched off.
      set({ plotFields: next, showPlot: next.length > 0 ? true : get().showPlot })
      save()
    },
    setLogPane: (logPane) => {
      set({ logPane })
      save()
    },
    reset: () => {
      set(DEFAULTS)
      save()
    },
  }
})
