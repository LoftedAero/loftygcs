import { create } from 'zustand'

// Did that change reach the vehicle?
//
// A screen that writes immediately owes an answer to that question, and
// Mission Planner's equivalent screens do not give one: you change a value
// and nothing tells you whether it landed. A parameter write is acked, so the
// answer exists -- it was simply never shown.
//
// Deliberately one slot rather than a queue. These writes come from a person
// changing one control at a time, and a stack of "Saved" notes for edits they
// have already moved past is noise; the latest outcome is the one that
// matters. A failure is the exception and does not clear itself: a success
// that fades is fine, a failure that fades is a value someone believes they
// set.

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
   * Something has been changed that the vehicle only reads at boot.
   *
   * ArduPilot marks those parameters `RebootRequired` in its own metadata --
   * COMPASS_PRIO1_ID and friends carry it -- and a compass calibration is the
   * same shape of fact: the offsets are saved, and the running firmware is
   * still flying on the old ones. Until the vehicle restarts, the screen and
   * the aircraft disagree, which is worth saying rather than leaving for
   * somebody to discover in the air.
   *
   * One reason string, not a list: the prompt is "restart to apply", and
   * enumerating everything that contributed to it helps nobody.
   */
  rebootPending: string | null
  needReboot: (reason: string) => void
  rebootDone: () => void
  /**
   * The dialog was answered with Later.
   *
   * The need does not go away, so the reminder does not either -- it steps
   * back to a line on the card. Asking again in a dialog for the same change
   * would be nagging, and the second dialog is the one people learn to
   * dismiss without reading.
   */
  rebootDeferred: boolean
  deferReboot: () => void
}

export const useWriteFeedbackStore = create<WriteFeedbackStore>((set) => ({
  latest: null,
  report: (f) => set({ latest: { ...f, at: Date.now() } }),
  clear: () => set({ latest: null }),

  rebootPending: null,
  // A new reason re-opens the dialog: it is news again.
  needReboot: (reason) => set({ rebootPending: reason, rebootDeferred: false }),
  rebootDone: () => set({ rebootPending: null, rebootDeferred: false }),
  rebootDeferred: false,
  deferReboot: () => set({ rebootDeferred: true }),
}))
