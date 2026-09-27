import { create } from 'zustand'
import { useParamStore } from './param-store'
import type { ConnectionPhase } from './connection-store'

// Navigation is two levels. The top level is a mode; only Setup has a tab
// rail, and the others are full-window. The simulator is not a mode: it lives
// in the app bar's tray (SimTray) so it is reachable from any screen.
//
// Modes run Fly to Setup, Mission Planner's order.
export const MODES = [
  { id: 'fly', label: 'Fly' },
  // Labeled "Plan" (QGroundControl's and Mission Planner's word) because the
  // mode edits three plans, only one of them a mission. The id stays
  // `mission` so saved state and deep links keep working.
  { id: 'mission', label: 'Plan' },
  { id: 'setup', label: 'Setup' },
] as const

export type ModeId = (typeof MODES)[number]['id']

/**
 * The Setup rail's groups, named after Mission Planner's: one-time bring-up,
 * per-airframe configuration, and data. Mission Planner's Mandatory/Optional
 * split is not used, since that depends on the airframe rather than the screen.
 *
 * Ports precedes Sensors because SERIALn_PROTOCOL gates whether an external
 * compass or GPS is detected at all.
 */
export const TAB_GROUPS = ['Initial Setup', 'Config/Tuning', 'Data'] as const

export type TabGroup = (typeof TAB_GROUPS)[number]

/**
 * The Setup rail.
 *
 * `fills` marks a tab with its own full-height layout rather than tiled
 * cards. Every screen with an actions column needs it: on the card grid
 * (`align-items: start`) `flex: 1` is inert, so the page would scroll and
 * take the column with it, and the parameter table's virtualizer would have
 * no bounded height to virtualize against.
 *
 * `offline` marks a tab that works on a document (a firmware image, a
 * parameter file, a log) rather than a live vehicle. Other tabs leave the
 * rail while disconnected, as in Mission Planner.
 */
export const TABS = [
  { id: 'overview', label: 'Overview', group: 'Initial Setup', fills: true },
  { id: 'firmware', label: 'Firmware', group: 'Initial Setup', offline: true },
  // Where a new airframe starts: battery monitor, failsafe, arming checks.
  { id: 'configuration', label: 'Configuration', group: 'Initial Setup' },
  { id: 'ports', label: 'Ports', group: 'Initial Setup' },
  // Two columns of its own rather than the card grid: see `.sensors-screen`.
  { id: 'sensors', label: 'Sensors', group: 'Initial Setup', fills: true },

  { id: 'radio', label: 'Radio', group: 'Config/Tuning' },
  { id: 'modes', label: 'Flight Modes', group: 'Config/Tuning' },
  { id: 'outputs', label: 'Outputs', group: 'Config/Tuning' },
  { id: 'power', label: 'Power', group: 'Config/Tuning' },
  { id: 'failsafes', label: 'Failsafe', group: 'Config/Tuning' },
  // Full height: the preview is sized from the space available.
  { id: 'osd', label: 'OSD', group: 'Config/Tuning', fills: true },
  // Before Tuning: notches are set from a log first, then gains tuned.
  { id: 'filters', label: 'Filters', group: 'Config/Tuning' },
  { id: 'tuning', label: 'Tuning', group: 'Config/Tuning' },
  // Ids stay fixed when labels change, so saved tabs and deep links keep working.
  { id: 'parameters', label: 'Parameter List', group: 'Config/Tuning', fills: true, offline: true },

  // Diagnostic tools rather than setup steps.
  { id: 'logs', label: 'Log Review', group: 'Data', fills: true, offline: true },
  { id: 'files', label: 'MAVFTP', group: 'Data', fills: true },
  { id: 'inspector', label: 'Inspector', group: 'Data', fills: true },
] as const

export type TabId = (typeof TABS)[number]['id']

/**
 * Whether the vehicle-only tabs stay in the rail. Rebooting counts, since the
 * app reconnects on its own and the user should stay on their screen; if the
 * vehicle never returns, the phase goes idle and the tabs leave then.
 */
export function holdsVehicleTabs(phase: ConnectionPhase): boolean {
  return phase === 'connected' || phase === 'linkLost' || phase === 'rebooting'
}

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

  /** The preferences dialog. */
  preferencesOpen: boolean
  setPreferencesOpen: (open: boolean) => void

  /** The app bar's simulator tray. In the store because other screens open it. */
  simTrayOpen: boolean
  setSimTrayOpen: (open: boolean) => void

  /**
   * The map picker for the simulator's home location. Not mounted inside the
   * tray, which dismisses on any outside click, including one on the map.
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
 * Staged edits belong to the page they were made on, so leaving a page with
 * unwritten changes prompts. The check lives in the store so every
 * navigation path is guarded.
 */
function blocked(): boolean {
  return useParamStore.getState().dirtyCount > 0
}

export const useUiStore = create<UiState>((set, get) => ({
  // The flight screen works with or without a vehicle.
  mode: 'fly',
  activeTab: 'overview',
  connectModalOpen: false,
  setConnectModalOpen: (connectModalOpen) => set({ connectModalOpen }),
  preferencesOpen: false,
  setPreferencesOpen: (preferencesOpen) => set({ preferencesOpen }),
  simTrayOpen: false,
  setSimTrayOpen: (simTrayOpen) => set({ simTrayOpen }),

  fieldPickerOpen: false,
  // Opening it closes the tray rather than racing the tray's click-away.
  setFieldPickerOpen: (fieldPickerOpen) =>
    set(fieldPickerOpen ? { fieldPickerOpen, simTrayOpen: false } : { fieldPickerOpen }),
  pendingNav: null,

  setMode: (mode) => {
    // Re-selecting the current mode is not leaving it.
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
