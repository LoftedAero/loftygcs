import { create } from 'zustand'
import {
  RATE_FLOOR,
  TURNS_REQUIRED,
  orientationFor,
  verticalRate,
  type OrientationId,
} from '../protocol/cal-orientation'

// Calibration wizard state, fed by the connection service from protocol
// events. Wizards render from here; they act through connectionService.

export interface MagCalCompass {
  pct: number
  calStatus: number
  /**
   * Which of the sphere's eighty sections this compass has samples for.
   *
   * Ten bytes, straight from MAG_CAL_PROGRESS. Every ground station throws
   * this away and shows the percentage beside it instead; it is the only
   * thing in the message that answers "which way have I not pointed it yet".
   */
  mask: number[]
  /** Where the vehicle is pointing, so the sphere can show you on it. */
  direction: [number, number, number]
  report: { calStatus: number; fitness: number; autosaved: number } | null
}

export interface MagCalState {
  running: boolean
  /**
   * Radians turned about earth vertical in each of the six attitudes.
   *
   * The vehicle is not asked where it has been -- this is measured here from
   * ATTITUDE, because ArduPilot reports coverage as a sphere of magnetic
   * directions and not as "you have done four of the six". Two full turns in
   * each is the instruction both Mission Planner and QGroundControl give, and
   * it is what actually fills the sphere.
   */
  turns: Partial<Record<OrientationId, number>>
  /** The attitude the vehicle is in now, or null if it is between them. */
  at: OrientationId | null
  /**
   * Progress and outcome per compass, keyed by the id the vehicle sends.
   *
   * MAG_CAL_PROGRESS and MAG_CAL_REPORT both carry a `compassId`, and
   * ArduPilot calibrates every used compass at once -- a mask of them, from
   * one DO_START_MAG_CAL. This used to keep a single percentage, so on a
   * vehicle with two or three compasses the bar was whichever of them
   * reported last: it jumped backwards, and finishing one made it look as
   * though the whole calibration had finished. They are separate
   * calibrations and they progress at different rates, because they see
   * different parts of the rotation.
   */
  compasses: Record<number, MagCalCompass>
}

interface CalState {
  magCal: MagCalState
  /**
   * The side the vehicle is asking to be placed in, as it asks for it.
   *
   * 1..6 while a calibration is running; ArduPilot also repeats a terminal
   * SUCCESS/FAILED here long after a run is over, which is why the wizard
   * reads only the six. Null before anything has been asked for.
   *
   * The arrival time rides with it because the vehicle repeats itself: a
   * wizard that opens has to tell "this is what it wants *now*" from a value
   * left over from the last run, and only the clock can say which.
   */
  accelAsked: { position: number; at: number } | null
  setAccelAsked: (position: number | null) => void
  /** One ATTITUDE sample: classify it, and integrate the turn. */
  magCalAttitude: (
    rollRad: number,
    pitchRad: number,
    rates: { rollRateRad: number; pitchRateRad: number; yawRateRad: number },
    /** Arrival time, for the gap between samples. Defaults to now. */
    nowMs?: number,
  ) => void
  magCalStarted: () => void
  magCalProgress: (
    compassId: number,
    pct: number,
    calStatus: number,
    mask: number[],
    direction: [number, number, number],
  ) => void
  magCalReport: (compassId: number, report: NonNullable<MagCalCompass['report']>) => void
  magCalReset: () => void
}

const MAG_IDLE: MagCalState = { running: false, compasses: {}, turns: {}, at: null }

/** Turned enough in this attitude to move on. */
export function orientationDone(s: MagCalState, id: OrientationId): boolean {
  // The vehicle's account outranks ours. These tiles are a guess at coverage
  // made from attitude alone, and the thing that actually decides a
  // calibration is the sphere of magnetic samples the firmware is filling --
  // which it reports. It finishes first often enough to matter (a compass
  // gets samples from every attitude it passes *through*, not only the six it
  // is held in), and tiles still reading "to do" after the vehicle has
  // stopped asking is the screen contradicting the aircraft.
  if (magCalSampled(s)) return true
  return (s.turns[id] ?? 0) >= TURNS_REQUIRED * 2 * Math.PI
}

/**
 * Every compass has all the samples it wants.
 *
 * Not `some`: with two compasses one reaches 100% before the other, because
 * they see different parts of the rotation, and calling the procedure over
 * then would stop asking for the turns the second one is still short of.
 */
export function magCalSampled(s: MagCalState): boolean {
  const list = magCalList(s)
  return list.length > 0 && list.every(([, c]) => c.report !== null || c.pct >= 100)
}

/**
 * Wall clock, kept outside the store.
 *
 * The gap between samples is what turns a rate into an angle, and it belongs
 * to the arrival of the message rather than to any render.
 */
let lastAttitudeAt = 0

/** Every compass that has reported, lowest id first. */
export function magCalList(s: MagCalState): [number, MagCalCompass][] {
  return Object.entries(s.compasses)
    .map(([id, c]) => [Number(id), c] as [number, MagCalCompass])
    .sort((a, b) => a[0] - b[0])
}

/** A run is over when every compass that reported has a report. */
export function magCalFinished(s: MagCalState): boolean {
  const list = magCalList(s)
  return list.length > 0 && list.every(([, c]) => c.report !== null)
}

export const useCalStore = create<CalState>((set) => ({
  magCal: MAG_IDLE,
  accelAsked: null,
  setAccelAsked: (position) =>
    set({ accelAsked: position === null ? null : { position, at: Date.now() } }),
  magCalStarted: () => {
    lastAttitudeAt = 0
    set({ magCal: { running: true, compasses: {}, turns: {}, at: null } })
  },

  magCalAttitude: (rollRad, pitchRad, rates, nowMs) =>
    set((s) => {
      if (!s.magCal.running) return {}
      // The caller may supply the time: integrating a rate needs a real
      // interval, and a function that reads the clock itself cannot be
      // tested against one.
      const now = nowMs ?? performance.now()
      const dt = lastAttitudeAt ? (now - lastAttitudeAt) / 1000 : 0
      lastAttitudeAt = now
      const at = orientationFor(rollRad, pitchRad)
      // A gap means the stream stalled or the screen was away; integrating
      // across it would credit a turn nobody made.
      if (!at || dt <= 0 || dt > 0.5) return { magCal: { ...s.magCal, at } }
      const rate = verticalRate(rollRad, pitchRad, rates)
      if (rate < RATE_FLOOR) return { magCal: { ...s.magCal, at } }
      return {
        magCal: {
          ...s.magCal,
          at,
          turns: { ...s.magCal.turns, [at]: (s.magCal.turns[at] ?? 0) + rate * dt },
        },
      }
    }),
  magCalProgress: (compassId, pct, calStatus, mask, direction) =>
    set((s) => ({
      magCal: {
        ...s.magCal,
        running: true,
        compasses: {
          ...s.magCal.compasses,
          [compassId]: {
            ...s.magCal.compasses[compassId],
            pct,
            calStatus,
            mask,
            direction,
            report: null,
          },
        },
      },
    })),
  magCalReport: (compassId, report) =>
    set((s) => {
      const compasses = {
        ...s.magCal.compasses,
        [compassId]: {
          pct: s.magCal.compasses[compassId]?.pct ?? 100,
          calStatus: report.calStatus,
          mask: s.magCal.compasses[compassId]?.mask ?? [],
          direction: s.magCal.compasses[compassId]?.direction ?? [0, 0, 0],
          report,
        },
      }
      // Still running while any compass is short of its report: one finishing
      // is not the calibration finishing.
      const running = Object.values(compasses).some((c) => c.report === null)
      return { magCal: { ...s.magCal, running, compasses } }
    }),
  magCalReset: () => set({ magCal: MAG_IDLE }),
}))
