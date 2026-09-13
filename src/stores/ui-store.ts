import { create } from 'zustand'
import { useParamStore } from './param-store'

// Navigation is two levels. The top level is a *mode* -- what you are doing
// with the vehicle right now -- and only Setup has a tab rail; the rest are
// full-window. Both Mission Planner and QGC
// arrived at the same split, because configuring and operating an aircraft
// are different activities that want different screens.
//
// The simulator used to be a fourth mode and is not one: it is something
// you switch on before doing one of these, not an activity in itself. It
// lives in the app bar's tray (SimTray) so it stays reachable from whatever
// screen the work is on.
// Fly first and Setup last, which is the order Mission Planner puts them in
// and the order the work happens in: flying is what the app is for, and
// setup is where you go when something about the aircraft needs changing.
// It also means the app opens on the screen someone is most often after.
export const MODES = [
  { id: 'fly', label: 'Fly' },
  // "Plan" rather than "Mission", which is both QGroundControl's and Mission
  // Planner's word for this view -- and the more accurate one here, since the
  // mode edits three plans and only one of them is a mission. The id stays
  // `mission`: a saved mode and every deep link already say it. The switch
  // *inside* the mode keeps "Mission" for the plan it names.
  { id: 'mission', label: 'Plan' },
  { id: 'setup', label: 'Setup' },
] as const

export type ModeId = (typeof MODES)[number]['id']

/**
 * The Setup rail, in three groups.
 *
 * Sixteen items in one list read as sixteen things to do. The names lean on
 * Mission Planner's, because anyone arriving here has almost certainly used
 * it and a familiar vocabulary beats a better one nobody knows -- but its
 * Mandatory/Optional split is not carried over. That distinction is a
 * property of the *airframe*, not of the screen: a battery monitor is
 * optional until the vehicle has one, at which point setting it up is not.
 * A rail cannot know which, and a label that is wrong half the time teaches
 * people to stop reading labels.
 *
 * So: what you do once when a board is new, what you set and adjust for a
 * particular airframe, and what you read afterwards.
 *
 * Ports sits ahead of Sensors deliberately: SERIALn_PROTOCOL decides whether
 * an external compass or GPS is detected at all, so a board whose ports are
 * not configured will not find them -- and calibrating a compass the
 * firmware never saw is the classic dead end. The order is the only place
 * that warns about it, which is why it is worth keeping.
 */
export const TAB_GROUPS = ['Initial Setup', 'Config/Tuning', 'Data'] as const

export type TabGroup = (typeof TAB_GROUPS)[number]

/**
 * The setup rail.
 *
 * `fills` marks a tab that brings its own full-height layout rather than a
 * set of cards to tile -- Overview's model sits beside a column of readouts
 * and is sized by it, so on the card grid (which sizes every row to its
 * content) it collapsed to whatever the shortest column of vitals allowed.
 * Those tabs get the same treatment Fly and Mission get: the content pane
 * stops being a grid and hands them the window.
 *
 * `offline` marks a tab that is worth opening with nothing connected --
 * because it works on a *document* rather than on a live aircraft. Overview
 * is deliberately not one: it draws itself rather than describing itself,
 * which is why it survived the earlier pass, but what it draws is a vehicle,
 * and with none there is nothing on it to read. That is
 * the line Mission Planner draws and QGroundControl draws with it: a mission,
 * a parameter file, a firmware image and the app's own settings all have
 * something to do offline; accelerometer calibration does not. Everything
 * without the flag leaves the rail while disconnected, which is Mission
 * Planner's behaviour and stated in its own wiki -- "You will only see this
 * menu item if the autopilot is connected."
 *
 * The alternative was a card on each of them saying what the screen would
 * have shown, which is what this app did and what none of the three
 * references do. A rail that lists only what can be done now is a shorter
 * lie-free answer than eleven descriptions of screens you cannot use.
 *
 * The four screens with an actions column need it for a second reason, and
 * went without it for a while: each one's root sets `flex: 1; min-height: 0`
 * expecting to fill, and on the card grid -- whose `align-items` is `start`
 * -- `flex` is inert, so they were sized by their content and the *page*
 * scrolled instead. Two things follow from that, and both were live bugs.
 * The actions column scrolled away with everything else, when the whole
 * point of a column is that it stays beside what it acts on. And the
 * parameter table's virtualizer measures its own scroll box, which had no
 * bounded height, so it had no window to virtualize against -- 1,400 rows
 * of a list that exists to render a slice.
 */
export const TABS = [
  { id: 'overview', label: 'Overview', group: 'Initial Setup', fills: true },
  { id: 'firmware', label: 'Firmware', group: 'Initial Setup', offline: true },
  // The curated cards lead the rest: it is where a new airframe starts, and
  // the things they cover -- battery monitor, failsafe, arming checks -- are
  // exactly the ones a first bring-up would not think to look for under
  // their own tabs.
  { id: 'configuration', label: 'Configuration', group: 'Initial Setup' },
  { id: 'ports', label: 'Ports', group: 'Initial Setup' },
  // Two columns of its own rather than the card grid: see `.sensors-screen`.
  { id: 'sensors', label: 'Sensors', group: 'Initial Setup', fills: true },

  { id: 'radio', label: 'Radio', group: 'Config/Tuning' },
  { id: 'modes', label: 'Flight Modes', group: 'Config/Tuning' },
  { id: 'outputs', label: 'Outputs', group: 'Config/Tuning' },
  { id: 'power', label: 'Power', group: 'Config/Tuning' },
  { id: 'failsafes', label: 'Failsafe', group: 'Config/Tuning' },
  { id: 'osd', label: 'OSD', group: 'Config/Tuning' },
  { id: 'tuning', label: 'Tuning', group: 'Config/Tuning' },
  // The label changed, the id did not: `parameters` is what a saved tab and
  // every deep link already say, and renaming it would strand both.
  { id: 'parameters', label: 'Parameter List', group: 'Config/Tuning', fills: true, offline: true },

  // Not steps at all: what you reach for when a step misbehaves.
  // The label changed, the id did not -- the same rule the parameters tab
  // follows: `logs` is what a saved tab and every deep link already say.
  { id: 'logs', label: 'Log Review', group: 'Data', fills: true, offline: true },
  { id: 'files', label: 'MAVFTP', group: 'Data', fills: true },
  { id: 'inspector', label: 'Inspector', group: 'Data', fills: true },
] as const

export type TabId = (typeof TABS)[number]['id']

/** The tabs to show, given whether a vehicle is on the link. */
export function visibleTabs(connected: boolean): typeof TABS {
  return (connected ? TABS : TABS.filter((t) => 'offline' in t && t.offline)) as typeof TABS
}

/** Whether this tab lays out its own window instead of tiling cards. */
export function tabFills(tab: TabId): boolean {
  return TABS.some((t) => t.id === tab && 'fills' in t && t.fills)
}

/** Where the user asked to go, held until unwritten changes are dealt with. */
export interface PendingNav {
  mode: ModeId
  tab?: TabId
}

interface UiState {
  mode: ModeId
  activeTab: TabId
  setMode: (mode: ModeId) => void
  setTab: (tab: TabId) => void
  /** The host/port dialog for network links. */
  connectModalOpen: boolean
  setConnectModalOpen: (open: boolean) => void

  /** Units, appearance, and whatever else belongs to the person. */
  preferencesOpen: boolean
  setPreferencesOpen: (open: boolean) => void

  /**
   * The app bar's simulator tray.
   *
   * In the store rather than inside SimTray because other screens send
   * people to it -- Overview's "Run a simulator…" used to be a mode switch,
   * and pointing at the tray keeps that route working.
   */
  simTrayOpen: boolean
  setSimTrayOpen: (open: boolean) => void

  /**
   * The map picker for the simulator's home location.
   *
   * Here rather than in SimulatorControls, which is what opens it: the tray
   * dismisses on any outside click, so a dialog mounted inside it would
   * unmount the moment someone clicked the map it is made of.
   */
  fieldPickerOpen: boolean
  setFieldPickerOpen: (open: boolean) => void

  /** Non-null while a navigation is waiting on staged parameter edits. */
  pendingNav: PendingNav | null
  /** Go where the user asked, guard already satisfied. */
  commitPendingNav: () => void
  /** Stay put. */
  cancelPendingNav: () => void
}

/**
 * Staged edits belong to the page they were made on.
 *
 * The parameter store is global -- one dirty set, written by one button --
 * which made it possible to change a failsafe here, a servo function there,
 * and send all of it later from a third screen with no record of where any of
 * it came from. Intercepting navigation is what turns that back into a
 * per-page transaction: leave a page with unwritten changes and it asks.
 *
 * The check lives in the store rather than in the two components that
 * navigate today, so a third one added later is guarded without anyone
 * remembering to guard it.
 */
function blocked(): boolean {
  return useParamStore.getState().dirtyCount > 0
}

export const useUiStore = create<UiState>((set, get) => ({
  // Fly, not Setup: the flight screen draws its map, HUD and controls with
  // or without a vehicle, so opening on it costs nothing when nothing is
  // connected and saves a click when something is.
  mode: 'fly',
  activeTab: 'overview',
  connectModalOpen: false,
  setConnectModalOpen: (connectModalOpen) => set({ connectModalOpen }),
  preferencesOpen: false,
  setPreferencesOpen: (preferencesOpen) => set({ preferencesOpen }),
  simTrayOpen: false,
  setSimTrayOpen: (simTrayOpen) => set({ simTrayOpen }),

  fieldPickerOpen: false,
  // Opening it closes the tray rather than racing the tray's click-away,
  // which would otherwise dismiss the tray on the first click on the map.
  setFieldPickerOpen: (fieldPickerOpen) =>
    set(fieldPickerOpen ? { fieldPickerOpen, simTrayOpen: false } : { fieldPickerOpen }),
  pendingNav: null,

  setMode: (mode) => {
    // Going nowhere is not leaving: re-selecting the current mode must not
    // put a dialog in the way.
    if (mode === get().mode) return
    if (blocked()) set({ pendingNav: { mode } })
    else set({ mode })
  },

  // Picking a tab implies you want the rail, so it also returns to Setup.
  setTab: (tab) => {
    const s = get()
    if (tab === s.activeTab && s.mode === 'setup') return
    if (blocked()) set({ pendingNav: { mode: 'setup', tab } })
    else set({ activeTab: tab, mode: 'setup' })
  },

  commitPendingNav: () => {
    const nav = get().pendingNav
    if (!nav) return
    set({
      mode: nav.mode,
      ...(nav.tab ? { activeTab: nav.tab } : {}),
      pendingNav: null,
    })
  },

  cancelPendingNav: () => set({ pendingNav: null }),
}))
