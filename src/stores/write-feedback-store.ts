import { create } from 'zustand'

// Did that change reach the vehicle? Parameter writes are acked, and screens
// that write immediately show the result here.
//
// One slot rather than a queue: edits happen one control at a time and only
// the latest outcome matters. A success fades; a failure stays until cleared,
// or someone would believe they had set a value they had not.

export interface WriteFeedback {
  ok: boolean
  /** What was written, for a failure that has to name it. */
  param: string
  error?: string
  /** Distinguishes two writes of the same parameter, so the fade restarts. */
  at: number
}

interface WriteFeedbackStore {
  latest: WriteFeedback | null
  report: (f: Omit<WriteFeedback, 'at'>) => void
  clear: () => void

  /**
   * Something changed that the vehicle only reads at boot: a parameter
   * ArduPilot's metadata marks `RebootRequired` (COMPASS_PRIO1_ID, for
   * example), or a compass calibration whose offsets are saved but not yet in
   * use. One reason string, since the prompt is just "restart to apply".
   */
  rebootPending: string | null
  /**
   * The title of the card whose change needs the restart, where the reminder
   * shows after Later; null for a change made outside a card (a screen's
   * column, whose Reboot button is always there).
   */
  rebootSource: string | null
  needReboot: (reason: string, source?: string | null) => void
  rebootDone: () => void
  /**
   * The dialog was answered with Later. The reminder stays as a line on the
   * card rather than asking again in a dialog.
   */
  rebootDeferred: boolean
  deferReboot: () => void
}

export const useWriteFeedbackStore = create<WriteFeedbackStore>((set) => ({
  latest: null,
  report: (f) => set({ latest: { ...f, at: Date.now() } }),
  clear: () => set({ latest: null }),

  rebootPending: null,
  rebootSource: null,
  // A new reason re-opens the dialog.
  needReboot: (reason, source = null) =>
    set({ rebootPending: reason, rebootSource: source, rebootDeferred: false }),
  rebootDone: () => set({ rebootPending: null, rebootSource: null, rebootDeferred: false }),
  rebootDeferred: false,
  deferReboot: () => set({ rebootDeferred: true }),
}))
