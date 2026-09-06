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
import { SURVEY_DEFAULTS, type SurveyOptions } from '../protocol/survey'
import {
  emptyFence,
  fenceToItems,
  newFenceUid,
  type FencePlan,
  type FenceShape,
  type FenceShapePatch,
  type RallyPoint,
} from '../protocol/geofence'
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

/**
 * The divider position, versioned.
 *
 * A stored split outranks the default, which is right -- it is a choice
 * someone made by dragging. But the default changed because the *pane*
 * changed underneath it: the altitude profile is twice the height it was,
 * and a split chosen for the old one leaves the new profile squeezed. A
 * value stored against the old layout is not a preference about this one,
 * so the key is bumped and everyone starts from the new default once.
 * Drag it anywhere and that is kept, as before.
 */
const SPLIT_KEY = 'loftgcs.mission.split.v2'

/** Enough for the profile at full height with a few rows of list under it. */
const DEFAULT_SPLIT = 0.55

function loadSplit(): number {
  try {
    const v = Number(localStorage.getItem(SPLIT_KEY))
    if (Number.isFinite(v) && v > 0.15 && v < 0.9) return v
    // The pane it was chosen for no longer exists; do not carry it over.
    localStorage.removeItem('loftgcs.mission.split')
  } catch {
    // Storage blocked; the default is a reasonable answer.
  }
  return DEFAULT_SPLIT
}

/**
 * Which of the three plans the screen is editing.
 *
 * All three are drawn on the map at once and only one takes clicks. Hiding
 * the fence while planning a mission is how you plan a mission through it,
 * so the switch changes what you *edit*, never what you can see.
 */
export type PlanKind = 'mission' | 'fence' | 'rally'

/** What a fence click means, while a fence is being drawn. */
export type FenceTool =
  'inclusionPolygon' | 'exclusionPolygon' | 'inclusionCircle' | 'exclusionCircle' | 'returnPoint'

/** Radius a freshly placed circle gets, in meters. Edited straight after. */
const NEW_CIRCLE_RADIUS_M = 100

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

  /**
   * The survey area being drawn, or null when not surveying. Held apart from
   * the plan because it is not itself a mission: the polygon is the input,
   * and the waypoints it generates are the output that gets flown. Keeping
   * the polygon means the grid can be re-cut at a different spacing without
   * redrawing the area.
   */
  survey: SurveyDraft | null
  startSurvey(): void
  cancelSurvey(): void
  addSurveyVertex(at: { x: number; y: number }): void
  moveSurveyVertex(index: number, at: { x: number; y: number }): void
  removeSurveyVertex(index: number): void
  setSurveyOptions(patch: Partial<SurveyOptions> & { altM?: number }): void

  editing: PlanKind
  setEditing(kind: PlanKind): void

  /** The geofence, and the vehicle's copy of it as far as we know. */
  fence: FencePlan
  fenceSynced: FencePlan | null
  /** Rally points, and the vehicle's copy. */
  rally: RallyPoint[]
  rallySynced: RallyPoint[] | null
  /** uid of the selected fence shape or rally point. */
  selectedShape: string | null
  selectShape(uid: string | null): void

  /** The armed fence tool, or null. Polygons collect corners in `fenceDraft`. */
  fenceTool: FenceTool | null
  fenceDraft: { x: number; y: number }[]
  setFenceTool(tool: FenceTool | null): void
  /** Route a map click by the armed tool. */
  placeFencePoint(at: { x: number; y: number }): void
  /** Commit the polygon under construction. Needs three corners. */
  finishFenceShape(): void
  removeShape(uid: string): void
  updateShape(uid: string, patch: FenceShapePatch): void
  moveShapeVertex(uid: string, index: number, at: { x: number; y: number }): void
  setFenceReturn(at: { x: number; y: number } | null): void
  setFence(fence: FencePlan, opts?: { synced?: boolean }): void

  addRally(at: { x: number; y: number }): void
  updateRally(uid: string, patch: Partial<Omit<RallyPoint, 'uid'>>): void
  removeRally(uid: string): void
  setRally(points: RallyPoint[], opts?: { synced?: boolean }): void

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

/** A survey area under construction, and how it should be flown. */
export interface SurveyDraft {
  polygon: { x: number; y: number }[]
  options: SurveyOptions
  /** Altitude for the generated passes, meters in the plan's frame. */
  altM: number
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
  survey: null,
  editing: 'mission',
  fence: emptyFence(),
  fenceSynced: null,
  rally: [],
  rallySynced: null,
  selectedShape: null,
  fenceTool: null,
  fenceDraft: [],

  setEditing(kind) {
    // Switching away abandons anything half-drawn: a two-corner polygon is
    // not a fence, and keeping it would only resurface later as a shape the
    // vehicle rejects.
    set({ editing: kind, fenceTool: null, fenceDraft: [], selectedShape: null })
  },
  selectShape(uid) {
    set({ selectedShape: uid })
  },
  setFenceTool(tool) {
    set({ fenceTool: tool, fenceDraft: [] })
  },

  placeFencePoint(at) {
    const { fenceTool, fenceDraft, fence } = get()
    if (!fenceTool) return
    switch (fenceTool) {
      case 'inclusionPolygon':
      case 'exclusionPolygon':
        set({ fenceDraft: [...fenceDraft, at] })
        return
      case 'inclusionCircle':
      case 'exclusionCircle': {
        // One click is a whole circle: there is nothing to accumulate, and
        // dragging out a radius on a map is a worse way to say "300 m" than
        // typing it into the field that appears.
        const uid = newFenceUid()
        const shape: FenceShape = {
          uid,
          kind: 'circle',
          inclusive: fenceTool === 'inclusionCircle',
          center: at,
          radiusM: NEW_CIRCLE_RADIUS_M,
        }
        set({
          fence: { ...fence, shapes: [...fence.shapes, shape] },
          fenceTool: null,
          selectedShape: uid,
        })
        return
      }
      case 'returnPoint':
        set({ fence: { ...fence, returnPoint: at }, fenceTool: null })
        return
    }
  },

  finishFenceShape() {
    const { fenceTool, fenceDraft, fence } = get()
    if (fenceTool !== 'inclusionPolygon' && fenceTool !== 'exclusionPolygon') return
    if (fenceDraft.length < 3) return
    const uid = newFenceUid()
    set({
      fence: {
        ...fence,
        shapes: [
          ...fence.shapes,
          {
            uid,
            kind: 'polygon',
            inclusive: fenceTool === 'inclusionPolygon',
            points: fenceDraft,
          },
        ],
      },
      fenceTool: null,
      fenceDraft: [],
      selectedShape: uid,
    })
  },

  removeShape(uid) {
    const { fence, selectedShape } = get()
    set({
      fence: { ...fence, shapes: fence.shapes.filter((s) => s.uid !== uid) },
      selectedShape: selectedShape === uid ? null : selectedShape,
    })
  },

  updateShape(uid, patch) {
    const { fence } = get()
    set({
      fence: {
        ...fence,
        shapes: fence.shapes.map((s) => (s.uid === uid ? ({ ...s, ...patch } as FenceShape) : s)),
      },
    })
  },

  moveShapeVertex(uid, index, at) {
    const { fence } = get()
    set({
      fence: {
        ...fence,
        shapes: fence.shapes.map((s) =>
          s.uid === uid && s.kind === 'polygon'
            ? { ...s, points: s.points.map((p, i) => (i === index ? at : p)) }
            : s,
        ),
      },
    })
  },

  setFenceReturn(at) {
    set({ fence: { ...get().fence, returnPoint: at } })
  },

  setFence(fence, opts) {
    set({
      fence,
      fenceTool: null,
      fenceDraft: [],
      selectedShape: null,
      ...(opts?.synced ? { fenceSynced: cloneFence(fence) } : {}),
    })
  },

  addRally(at) {
    const uid = newFenceUid()
    set({
      rally: [...get().rally, { uid, x: at.x, y: at.y, altM: get().defaults.altM }],
      selectedShape: uid,
    })
  },
  updateRally(uid, patch) {
    set({ rally: get().rally.map((p) => (p.uid === uid ? { ...p, ...patch } : p)) })
  },
  removeRally(uid) {
    const { rally, selectedShape } = get()
    set({
      rally: rally.filter((p) => p.uid !== uid),
      selectedShape: selectedShape === uid ? null : selectedShape,
    })
  },
  setRally(points, opts) {
    set({
      rally: points,
      selectedShape: null,
      ...(opts?.synced ? { rallySynced: points.map((p) => ({ ...p })) } : {}),
    })
  },

  startSurvey() {
    set({ survey: { polygon: [], options: { ...SURVEY_DEFAULTS }, altM: get().defaults.altM } })
  },
  cancelSurvey() {
    set({ survey: null })
  },
  addSurveyVertex(at) {
    const s = get().survey
    if (!s) return
    set({ survey: { ...s, polygon: [...s.polygon, at] } })
  },
  moveSurveyVertex(index, at) {
    const s = get().survey
    if (!s) return
    set({ survey: { ...s, polygon: s.polygon.map((p, i) => (i === index ? at : p)) } })
  },
  removeSurveyVertex(index) {
    const s = get().survey
    if (!s) return
    set({ survey: { ...s, polygon: s.polygon.filter((_, i) => i !== index) } })
  },
  setSurveyOptions(patch) {
    const s = get().survey
    if (!s) return
    const { altM, ...rest } = patch
    set({
      survey: {
        ...s,
        options: { ...s.options, ...rest },
        ...(altM !== undefined ? { altM } : {}),
      },
    })
  },

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
    const items = command === 22 ? [item, ...plan.items] : [...plan.items, item]
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

function cloneFence(f: FencePlan): FencePlan {
  return {
    returnPoint: f.returnPoint ? { ...f.returnPoint } : null,
    shapes: f.shapes.map((s) =>
      s.kind === 'polygon'
        ? { ...s, points: s.points.map((p) => ({ ...p })) }
        : { ...s, center: { ...s.center } },
    ),
  }
}

function clonePlan(p: MissionPlan): MissionPlan {
  return { home: p.home ? { ...p.home } : null, items: p.items.map((i) => ({ ...i })) }
}

/** Does the screen disagree with the vehicle? Null synced means unknown. */
export function isDirty(s: MissionState): boolean {
  if (!s.synced) return s.plan.items.length > 0
  return plansDiffer(s.plan, s.synced)
}

/**
 * Does the fence on screen disagree with the vehicle's?
 *
 * Compared through the wire form rather than field by field: that is exactly
 * what would be uploaded, so two fences that serialize the same are the same
 * fence however differently they were built.
 */
export function fenceDirty(s: MissionState): boolean {
  if (!s.fenceSynced) return s.fence.shapes.length > 0 || s.fence.returnPoint !== null
  return JSON.stringify(fenceToItems(s.fence)) !== JSON.stringify(fenceToItems(s.fenceSynced))
}

export function rallyDirty(s: MissionState): boolean {
  if (!s.rallySynced) return s.rally.length > 0
  const key = (p: RallyPoint) => `${p.x},${p.y},${p.altM}`
  return s.rally.map(key).join('|') !== s.rallySynced.map(key).join('|')
}

/** Convenience for the map and profile: the plan as wire items would number. */
export function seqOf(plan: MissionPlan, uid: string): number {
  return plan.items.findIndex((i) => i.uid === uid) + 1
}

export function itemsFromWire(items: readonly MissionItem[]): MissionPlan {
  return planFromItems(items)
}
