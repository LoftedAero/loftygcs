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

/** The lower pane's tabs, in the order they are shown. */
export const LOG_PANES = [
  { id: 'messages', label: 'Messages' },
  { id: 'status', label: 'Status' },
  { id: 'preflight', label: 'Preflight' },
  { id: 'camera', label: 'Camera' },
  { id: 'joystick', label: 'Joystick' },
  // The HUD's video source, beside the camera controls that point the thing
  // it is showing. It was a modal behind the View menu -- two levels down
  // from a screen where it is set up before flying, and a connection you
  // watch rather than a question to dismiss.
  { id: 'video', label: 'Video' },
  // Last, because it is the only one that is not about the aircraft. It was
  // a "View" button on the command bar, where everything else commands the
  // vehicle and this moved furniture.
  { id: 'view', label: 'View' },
] as const

export type LogPane = (typeof LOG_PANES)[number]['id']

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
  /** ADS-B traffic drawn on the map. */
  showTraffic: boolean
  /** Which telemetry fields the plot is drawing. */
  plotFields: string[]
  /** Last HUD video source, so it does not have to be retyped. */
  videoUrl: string
  /** Which plotted series the Y axis numbers belong to. */
  plotAxisField: string | null
  /**
   * What the lower pane is showing.
   *
   * Camera and joystick are panes here rather than panels of their own
   * because that is what they are: a thing you look at in the space under
   * the controls, one at a time, like the messages and the preflight list.
   * As separate panels they competed with those for the same room and had
   * to be found in a menu about window layout.
   */
  logPane: LogPane
  /** The artificial horizon. Off leaves the background layer showing. */
  hudHorizon: boolean
  /** Overlay elements drawn on the HUD, so they can be turned off for video. */
  hudOverlays: boolean

  setRatio: (r: number) => void
  swap: () => void
  toggle: (
    key:
      | 'showMap'
      | 'showHud'
      | 'showMessages'
      | 'showPlot'
      | 'hudHorizon'
      | 'hudOverlays'
      | 'showTraffic',
  ) => void
  togglePlotField: (name: string) => void
  setLogPane: (pane: LogPane) => void
  setPlotAxisField: (name: string) => void
  setVideoUrl: (url: string) => void
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
  logPane: LogPane
  plotAxisField: string | null
  videoUrl: string
  hudHorizon: boolean
  hudOverlays: boolean
  showTraffic: boolean
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
  plotAxisField: null,
  videoUrl: '',
  hudHorizon: true,
  hudOverlays: true,
  // On by default: a vehicle with no receiver draws nothing, so the cost of
  // it being on is zero, and traffic you did not know to switch on is the
  // traffic you do not see.
  showTraffic: true,
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
      // A pane that no longer exists would render nothing at all, with the
      // tab strip offering no clue which one is selected.
      logPane: LOG_PANES.some((t) => t.id === saved.logPane) ? saved.logPane! : DEFAULTS.logPane,
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
    plotAxisField: s.plotAxisField,
    videoUrl: s.videoUrl,
    hudHorizon: s.hudHorizon,
    hudOverlays: s.hudOverlays,
    showTraffic: s.showTraffic,
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
      const next = current.includes(name) ? current.filter((f) => f !== name) : [...current, name]
      // Adding the first field is always meant to show the plot; nobody picks
      // a field in order to look at a panel that is switched off.
      set({ plotFields: next, showPlot: next.length > 0 ? true : get().showPlot })
      save()
    },
    setLogPane: (logPane) => {
      set({ logPane })
      save()
    },
    setPlotAxisField: (plotAxisField) => {
      set({ plotAxisField })
      save()
    },
    setVideoUrl: (videoUrl) => {
      set({ videoUrl })
      save()
    },
    reset: () => {
      set(DEFAULTS)
      save()
    },
  }
})
