import { create } from 'zustand'
import { mergedLabels } from '../profiles'

// Guided-setup state. Two separate concerns live here:
//  - selectedProfileId: the aircraft the user has told us this is. Opt-in
//    and persisted; it turns on product labels app-wide. Cleared, the app
//    is exactly the generic GCS -- profiles never impose themselves.
//  - the active guide run: which guide, which step, what's done.

export type StepStatus = 'done' | 'skipped'

interface GuideState {
  selectedProfileId: string | null
  activeGuide: { profileId: string; guideId: string } | null
  stepIndex: number
  stepStatus: Record<number, StepStatus>
  selectProfile: (id: string | null) => void
  startGuide: (profileId: string, guideId: string) => void
  exitGuide: () => void
  markStep: (index: number, status: StepStatus) => void
  gotoStep: (index: number) => void
}

const STORAGE_KEY = 'loftgcs.selectedProfile'

function loadSelected(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function persistSelected(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Private windows etc.: selection just won't persist.
  }
}

export const useGuideStore = create<GuideState>((set) => ({
  selectedProfileId: loadSelected(),
  activeGuide: null,
  stepIndex: 0,
  stepStatus: {},

  selectProfile: (id) => {
    persistSelected(id)
    set({ selectedProfileId: id })
  },

  startGuide: (profileId, guideId) => {
    // Starting a product's guide IS declaring the aircraft.
    persistSelected(profileId)
    set({
      activeGuide: { profileId, guideId },
      stepIndex: 0,
      stepStatus: {},
      selectedProfileId: profileId,
    })
  },

  exitGuide: () => set({ activeGuide: null, stepIndex: 0, stepStatus: {} }),
  markStep: (index, status) =>
    set((s) => ({ stepStatus: { ...s.stepStatus, [index]: status } })),
  gotoStep: (stepIndex) => set({ stepIndex }),
}))

const EMPTY_LABELS = { outputLabels: {}, channelLabels: {} }
const labelCache = new Map<string, ReturnType<typeof mergedLabels>>()

/** Merged product labels, or empty maps when no aircraft is selected. */
export function useProfileLabels(): {
  outputLabels: Record<number, string>
  channelLabels: Record<number, string>
} {
  const id = useGuideStore((s) => s.selectedProfileId)
  if (!id) return EMPTY_LABELS
  let cached = labelCache.get(id)
  if (!cached) {
    cached = mergedLabels(id)
    labelCache.set(id, cached)
  }
  return cached
}
