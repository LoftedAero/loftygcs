import { create } from 'zustand'

// Which mission item compact Plan's editor shows (ItemEditor), shared by the
// map, whose markers open it, and the Plan screen, which shows it in the item
// sheet. Null when it is closed.

export const useItemEditor = create<{
  uid: string | null
  open: (uid: string) => void
  close: () => void
}>((set) => ({
  uid: null,
  open: (uid) => set({ uid }),
  close: () => set({ uid: null }),
}))
