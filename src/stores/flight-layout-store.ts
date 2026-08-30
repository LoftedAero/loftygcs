import { create } from 'zustand'

// How the Fly screen is arranged. Mission Planner lets you resize and swap
// the HUD and map; this is that, plus the ability to turn either off so one
// of them can fill the window -- which is what makes a video-only HUD work
// without being a special case.
//
// Persisted, because a layout you have to rebuild every session is worse
// than not being able to change it at all.

const STORAGE_KEY = 'loftgcs.flight.layout'

export type FlightPanel = 'map' | 'hud'

export interface FlightLayoutState {
  /** Fraction of the split taken by the first slot, 0.15..0.85. */
  ratio: number
  /** 'row' puts the panels side by side; 'column' stacks them. */
  orientation: 'row' | 'column'
  /** Which panel is in the first slot. The other takes the second. */
  first: FlightPanel
  showMap: boolean
  showHud: boolean
  showMessages: boolean
  /** The artificial horizon. Off leaves the background layer showing. */
  hudHorizon: boolean
  /** Overlay elements drawn on the HUD, so they can be turned off for video. */
  hudOverlays: boolean

  setRatio: (r: number) => void
  setOrientation: (o: 'row' | 'column') => void
  swap: () => void
  toggle: (key: 'showMap' | 'showHud' | 'showMessages' | 'hudHorizon' | 'hudOverlays') => void
  reset: () => void
}

/** The part of the layout that survives a reload. */
interface Persisted {
  ratio: number
  orientation: 'row' | 'column'
  first: FlightPanel
  showMap: boolean
  showHud: boolean
  showMessages: boolean
  hudHorizon: boolean
  hudOverlays: boolean
}

const DEFAULTS: Persisted = {
  ratio: 0.62,
  orientation: 'row',
  first: 'map',
  showMap: true,
  showHud: true,
  showMessages: true,
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

/** Keeps both panels usable however hard the divider is dragged. */
export function clampRatio(r: number): number {
  return Math.min(0.85, Math.max(0.15, r))
}

function snapshot(s: FlightLayoutState): Persisted {
  return {
    ratio: s.ratio,
    orientation: s.orientation,
    first: s.first,
    showMap: s.showMap,
    showHud: s.showHud,
    showMessages: s.showMessages,
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
    setOrientation: (orientation) => {
      set({ orientation })
      save()
    },
    swap: () => {
      set({ first: get().first === 'map' ? 'hud' : 'map' })
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
    reset: () => {
      set(DEFAULTS)
      save()
    },
  }
})
