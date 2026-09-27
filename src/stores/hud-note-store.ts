import { create } from 'zustand'

// The app's own notes about commands it sent, shown in the HUD's warning slot
// beside the vehicle's messages: a command with no answer, a refusal with no
// reason given, a mode this vehicle does not have.

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
