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
export const MODES = [
  { id: 'setup', label: 'Setup' },
  { id: 'fly', label: 'Fly' },
  { id: 'mission', label: 'Mission' },
] as const

export type ModeId = (typeof MODES)[number]['id']

// The Setup rail, ordered as a bring-up runs. Ports sits ahead of Sensors
// deliberately: SERIALn_PROTOCOL decides whether the external compass and
// GPS are detected at all, and calibrating a compass the board has not
// found is the classic dead end.
export const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'firmware', label: 'Firmware' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'ports', label: 'Ports' },
  { id: 'sensors', label: 'Sensors' },
  { id: 'radio', label: 'Radio' },
  { id: 'modes', label: 'Flight modes' },
  { id: 'outputs', label: 'Outputs' },
  { id: 'power', label: 'Power' },
  { id: 'failsafes', label: 'Failsafes' },
  { id: 'tuning', label: 'Tuning' },
  { id: 'osd', label: 'OSD' },
  { id: 'parameters', label: 'Parameters' },
  { id: 'logs', label: 'Logs' },
  // After Logs, deliberately: the rail above is the bring-up sequence and
  // the inspector is not a step in it -- it is the X-ray you reach for when
  // a step misbehaves.
  { id: 'inspector', label: 'Inspector' },
] as const

export type TabId = (typeof TABS)[number]['id']

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
  mode: 'setup',
  activeTab: 'overview',
  connectModalOpen: false,
  setConnectModalOpen: (connectModalOpen) => set({ connectModalOpen }),
  preferencesOpen: false,
  setPreferencesOpen: (preferencesOpen) => set({ preferencesOpen }),
  simTrayOpen: false,
  setSimTrayOpen: (simTrayOpen) => set({ simTrayOpen }),
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
