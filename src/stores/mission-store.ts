import { create } from 'zustand'
import {
  newUid,
  planFromItems,
  plansDiffer,
  type MissionPlan,
  type PlanHome,
  type PlanItem,
} from '../protocol/mission-plan'
import { commandSpec } from '../protocol/mission-commands'
import type { MissionItem } from '../protocol/types'

// The plan being edited, plus what is known about the vehicle's copy of it.
//
// `synced` is the last plan we know the vehicle has -- set by a successful
// read or write, and nothing else. Comparing against it is what makes the
// dirty state honest: not "has anything been clicked" but "does the vehicle
// disagree with the screen". A plan loaded from a file is dirty on arrival,
// because the vehicle has not seen it.

/** How new items are created, until the user says otherwise. */
export interface MissionDefaults {
  /** Altitude given to a freshly placed item, meters. */
  altM: number
  /** MAV_FRAME for new items: relative to home, AMSL, or terrain. */
  frame: number
}

export type TransferState =
  | { kind: 'idle' }
  | { kind: 'busy'; dir: 'read' | 'write'; got: number; total: number }
  | { kind: 'error'; text: string }
  | { kind: 'done'; text: string }

const SPLIT_KEY = 'loftgcs.mission.split'

function loadSplit(): number {
  try {
    const v = Number(localStorage.getItem(SPLIT_KEY))
    if (Number.isFinite(v) && v > 0.15 && v < 0.9) return v
  } catch {
    // Storage blocked; the default is a reasonable answer.
  }
  return 0.5
}

export interface MissionState {
  plan: MissionPlan
  /** The vehicle's copy, as far as we know it. Null before any transfer. */
  synced: MissionPlan | null
  defaults: MissionDefaults
  /** uid of the selected item, or 'home', or null. */
  selected: string | null
  transfer: TransferState
  /** Where the plan came from, for the title bar. */
  sourceName: string | null
  /** Fraction of the height given to the map, above the items list. */
  split: number
  setSplit(ratio: number): void

  setPlan(plan: MissionPlan, opts?: { synced?: boolean; name?: string }): void
  addItem(command: number, at?: { x: number; y: number }): string
  updateItem(uid: string, patch: Partial<Omit<PlanItem, 'uid'>>): void
  removeItem(uid: string): void
  moveItem(uid: string, toIndex: number): void
  setHome(home: PlanHome | null): void
  select(uid: string | null): void
  setDefaults(patch: Partial<MissionDefaults>): void
  setTransfer(t: TransferState): void
  markSynced(): void
  clear(): void
}

const emptyPlan = (): MissionPlan => ({ home: null, items: [] })

export const useMissionStore = create<MissionState>((set, get) => ({
  plan: emptyPlan(),
  synced: null,
  defaults: { altM: 50, frame: 3 },
  selected: null,
  transfer: { kind: 'idle' },
  sourceName: null,
  split: loadSplit(),

  setSplit(ratio) {
    // Clamped so the divider cannot be dragged until one pane has no usable
    // height -- a map or a table you have to drag back out of is worse than
    // one that simply stops.
    const clamped = Math.max(0.2, Math.min(0.85, ratio))
    set({ split: clamped })
    try {
      localStorage.setItem(SPLIT_KEY, String(clamped))
    } catch {
      // Not remembering the split is a nuisance, never a failure.
    }
  },

  setPlan(plan, opts) {
    set({
      plan,
      selected: null,
      // A file load leaves synced alone: the vehicle still holds whatever it
      // held, and the difference is exactly what the dirty flag should show.
      ...(opts?.synced ? { synced: clonePlan(plan) } : {}),
      ...(opts?.name !== undefined ? { sourceName: opts.name } : {}),
    })
  },

  addItem(command, at) {
    const { plan, defaults } = get()
    const spec = commandSpec(command)
    const uid = newUid()
    const item: PlanItem = {
      uid,
      frame: defaults.frame,
      command,
      autocontinue: 1,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: 0,
      x: at && spec?.location !== false ? at.x : 0,
      y: at && spec?.location !== false ? at.y : 0,
      z: spec?.altitude === false ? 0 : defaults.altM,
    }
    // A takeoff belongs first, wherever it was clicked -- it is the one
    // command whose position in the list is not a matter of taste, and an
    // RTL after it is the usual next thought.
    const items =
      command === 22 ? [item, ...plan.items] : [...plan.items, item]
    set({ plan: { ...plan, items }, selected: uid })
    return uid
  },

  updateItem(uid, patch) {
    const { plan } = get()
    set({
      plan: {
        ...plan,
        items: plan.items.map((it) => (it.uid === uid ? { ...it, ...patch } : it)),
      },
    })
  },

  removeItem(uid) {
    const { plan, selected } = get()
    set({
      plan: { ...plan, items: plan.items.filter((it) => it.uid !== uid) },
      selected: selected === uid ? null : selected,
    })
  },

  moveItem(uid, toIndex) {
    const { plan } = get()
    const from = plan.items.findIndex((it) => it.uid === uid)
    if (from < 0) return
    const items = [...plan.items]
    const [moved] = items.splice(from, 1)
    if (!moved) return
    items.splice(Math.max(0, Math.min(items.length, toIndex)), 0, moved)
    set({ plan: { ...plan, items } })
  },

  setHome(home) {
    set({ plan: { ...get().plan, home } })
  },

  select(uid) {
    set({ selected: uid })
  },

  setDefaults(patch) {
    set({ defaults: { ...get().defaults, ...patch } })
  },

  setTransfer(transfer) {
    set({ transfer })
  },

  markSynced() {
    set({ synced: clonePlan(get().plan) })
  },

  clear() {
    set({ plan: emptyPlan(), selected: null, sourceName: null })
  },
}))

function clonePlan(p: MissionPlan): MissionPlan {
  return { home: p.home ? { ...p.home } : null, items: p.items.map((i) => ({ ...i })) }
}

/** Does the screen disagree with the vehicle? Null synced means unknown. */
export function isDirty(s: MissionState): boolean {
  if (!s.synced) return s.plan.items.length > 0
  return plansDiffer(s.plan, s.synced)
}

/** Convenience for the map and profile: the plan as wire items would number. */
export function seqOf(plan: MissionPlan, uid: string): number {
  return plan.items.findIndex((i) => i.uid === uid) + 1
}

export function itemsFromWire(items: readonly MissionItem[]): MissionPlan {
  return planFromItems(items)
}
