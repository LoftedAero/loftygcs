import { create } from 'zustand'
import {
  hasCoords,
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
// `synced` is the last plan the vehicle is known to have, set only by a
// successful read or write. Dirty means the vehicle disagrees with the
// screen, so a plan loaded from a file is dirty on arrival.

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
 * The divider position. The key is versioned because a split stored against
 * an earlier pane layout does not fit the current one.
 */
const SPLIT_KEY = 'loftgcs.mission.split.v2'

/** Default divider: the profile at full height with two list rows below. */
const DEFAULT_SPLIT = 0.65

function loadSplit(): number {
  try {
    const v = Number(localStorage.getItem(SPLIT_KEY))
    if (Number.isFinite(v) && v > 0.15 && v < 0.9) return v
    // Drop the split stored under the old key.
    localStorage.removeItem('loftgcs.mission.split')
  } catch {
    // Storage blocked; use the default.
  }
  return DEFAULT_SPLIT
}

/**
 * Which of the three plans the screen is editing. All three are always
 * drawn; only the edited one takes clicks.
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
  /**
   * The center of the map view, degrees * 1e7. Where an item added from the
   * table goes when it has no neighbors and there is no home.
   */
  mapCenter: { x: number; y: number } | null
  setMapCenter(at: { x: number; y: number }): void
  /** Fraction of the height given to the map, above the items list. */
  split: number
  setSplit(ratio: number): void

  /**
   * The survey area being drawn, or null when not surveying. Kept apart from
   * the plan so the grid can be regenerated without redrawing the area.
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
  /** Insert after the item at `index` (the row's + button). -1 appends. */
  addItemAfter(index: number, command?: number): string
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

/**
 * Where an item added from the table goes on the map: midway between its
 * neighbors when it has two, otherwise on the item it follows, otherwise the
 * fallback.
 */
function insertPosition(
  plan: MissionPlan,
  index: number,
  fallback: { x: number; y: number } | null,
): { x: number; y: number } {
  const located = (i: number) => {
    const it = plan.items[i]
    return it && hasCoords(it) ? it : null
  }
  const at = index < 0 ? plan.items.length - 1 : index
  let before: { x: number; y: number } | null = null
  for (let i = at; i >= 0 && !before; i--) before = located(i)
  before = before ?? plan.home
  const after = located(at + 1)
  if (before && after) {
    return {
      x: Math.round((before.x + after.x) / 2),
      y: Math.round((before.y + after.y) / 2),
    }
  }
  if (before) return { x: before.x, y: before.y }
  return fallback ?? { x: 0, y: 0 }
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
  mapCenter: null,
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
    // Switching away abandons anything half-drawn.
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
        // One click places a circle at a default radius, edited afterward.
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

  setMapCenter(at) {
    const now = get().mapCenter
    if (now && now.x === at.x && now.y === at.y) return
    set({ mapCenter: at })
  },

  setSplit(ratio) {
    // Clamped so neither pane loses all usable height.
    const clamped = Math.max(0.2, Math.min(0.85, ratio))
    set({ split: clamped })
    try {
      localStorage.setItem(SPLIT_KEY, String(clamped))
    } catch {
      // Not remembering the split is harmless.
    }
  },

  setPlan(plan, opts) {
    set({
      plan,
      selected: null,
      // A file load leaves synced alone: the vehicle still holds what it held.
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
    // A takeoff always goes first.
    const items = command === 22 ? [item, ...plan.items] : [...plan.items, item]
    set({ plan: { ...plan, items }, selected: uid })
    return uid
  },

  addItemAfter(index, command = 16) {
    const { plan, defaults } = get()
    const spec = commandSpec(command)
    const at = insertPosition(plan, index, get().mapCenter)
    const item: PlanItem = {
      uid: newUid(),
      frame: defaults.frame,
      command,
      autocontinue: 1,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: 0,
      x: spec?.location === false ? 0 : at.x,
      y: spec?.location === false ? 0 : at.y,
      z: spec?.altitude === false ? 0 : defaults.altM,
    }
    const items = [...plan.items]
    items.splice(index < 0 ? items.length : index + 1, 0, item)
    set({ plan: { ...plan, items }, selected: item.uid })
    return item.uid
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
 * Does the fence on screen disagree with the vehicle's? Compared by wire
 * form, since that is what would be uploaded.
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
