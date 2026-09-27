import { create } from 'zustand'

// What the app itself has to say about a command it sent, for the HUD.
//
// The HUD shows the vehicle's own warnings, Mission Planner's arrangement,
// and a refusal's reason is nearly always one of those. This is for the rest:
// a command that got no answer, a refusal the vehicle gave no reason for, a
// mode this vehicle does not have. Same slot, so there is one place to look.

export interface HudNote {
  text: string
  at: number
}

interface HudNoteState {
  note: HudNote | null
  say(text: string): void
  clear(): void
}

export const useHudNoteStore = create<HudNoteState>((set) => ({
  note: null,
  say: (text) => set({ note: { text, at: Date.now() } }),
  clear: () => set({ note: null }),
}))
