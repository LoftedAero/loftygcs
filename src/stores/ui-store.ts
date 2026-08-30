import { create } from 'zustand'

// Navigation is two levels. The top level is a *mode* -- what you are doing
// with the vehicle right now -- and only Setup has a tab rail; the rest are
// full-window. Both Mission Planner and QGC
// arrived at the same split, because configuring and operating an aircraft
// are different activities that want different screens.
export const MODES = [
  { id: 'setup', label: 'Setup' },
  { id: 'fly', label: 'Fly' },
  { id: 'mission', label: 'Mission' },
  { id: 'simulator', label: 'Simulator' },
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
] as const

export type TabId = (typeof TABS)[number]['id']

interface UiState {
  mode: ModeId
  activeTab: TabId
  setMode: (mode: ModeId) => void
  setTab: (tab: TabId) => void
  /** The host/port dialog for network links. */
  connectModalOpen: boolean
  setConnectModalOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>((set) => ({
  mode: 'setup',
  activeTab: 'overview',
  setMode: (mode) => set({ mode }),
  // Picking a tab implies you want the rail, so it also returns to Setup.
  setTab: (activeTab) => set({ activeTab, mode: 'setup' }),
  connectModalOpen: false,
  setConnectModalOpen: (connectModalOpen) => set({ connectModalOpen }),
}))
