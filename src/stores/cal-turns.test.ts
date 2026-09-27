import { beforeEach, describe, expect, it } from 'vitest'
import { useCalStore, orientationDone } from './cal-store'
import { TURNS_REQUIRED } from '../protocol/cal-orientation'

// A tile completes on turns, the integral of a rate over time. These drive
// the store with a fake clock to pin the arithmetic.

const feed = (opts: {
  roll?: number
  pitch?: number
  rate: { rollRateRad?: number; pitchRateRad?: number; yawRateRad?: number }
  seconds: number
  step?: number
  from?: number
}) => {
  const step = opts.step ?? 0.02
  let t = opts.from ?? 1000
  for (let elapsed = 0; elapsed < opts.seconds; elapsed += step) {
    t += step * 1000
    useCalStore
      .getState()
      .magCalAttitude(
        opts.roll ?? 0,
        opts.pitch ?? 0,
        { rollRateRad: 0, pitchRateRad: 0, yawRateRad: 0, ...opts.rate },
        t,
      )
  }
  return t
}

beforeEach(() => {
  useCalStore.getState().magCalReset()
  useCalStore.getState().magCalStarted()
})

describe('counting turns in each attitude', () => {
  it('completes a tile just short of two turns, and not at one', () => {
    // π rad/s for 2 s is one turn: not enough.
    feed({ rate: { yawRateRad: Math.PI }, seconds: 2 })
    expect(orientationDone(useCalStore.getState().magCal, 'level')).toBe(false)
    // Another 0.8 of a turn passes the threshold short of two: TURNS_REQUIRED
    // leaves slack because the vehicle is often satisfied before then.
    feed({ rate: { yawRateRad: Math.PI }, seconds: 1.6, from: 100000 })
    const turns = useCalStore.getState().magCal.turns.level ?? 0
    expect(orientationDone(useCalStore.getState().magCal, 'level')).toBe(true)
    expect(turns).toBeGreaterThan(TURNS_REQUIRED * 2 * Math.PI)
    expect(turns).toBeLessThan(2 * 2 * Math.PI)
  })

  it('marks every tile done once the vehicle has the samples it wants', () => {
    // The vehicle decides when calibration is done; the tiles are only an
    // estimate and must not keep asking for turns afterward.
    feed({ rate: { yawRateRad: Math.PI }, seconds: 1 })
    expect(orientationDone(useCalStore.getState().magCal, 'tailDown')).toBe(false)
    useCalStore.getState().magCalProgress(0, 100, 3, [], [0, 0, 0])
    expect(orientationDone(useCalStore.getState().magCal, 'tailDown')).toBe(true)
  })

  it('keeps asking while a second compass is still short', () => {
    // Compasses progress at different rates, so one at 100% does not mean done.
    useCalStore.getState().magCalProgress(0, 100, 3, [], [0, 0, 0])
    useCalStore.getState().magCalProgress(1, 62, 3, [], [0, 0, 0])
    expect(orientationDone(useCalStore.getState().magCal, 'tailDown')).toBe(false)
  })

  it('credits the attitude the vehicle is actually in', () => {
    // On its right side, spinning about vertical shows up as pitch rate.
    feed({ roll: Math.PI / 2, rate: { pitchRateRad: Math.PI }, seconds: 4.2 })
    const s = useCalStore.getState().magCal
    expect(orientationDone(s, 'rightSide')).toBe(true)
    expect(orientationDone(s, 'level')).toBe(false)
  })

  it('ignores a vehicle sitting still', () => {
    // Gyro noise and a hand on the bench must not fill a tile on their own.
    feed({ rate: { yawRateRad: 0.01 }, seconds: 30 })
    expect(useCalStore.getState().magCal.turns.level ?? 0).toBe(0)
  })

  it('ignores rotation that is not about vertical', () => {
    feed({ rate: { rollRateRad: Math.PI, pitchRateRad: Math.PI }, seconds: 6 })
    expect(orientationDone(useCalStore.getState().magCal, 'level')).toBe(false)
  })

  it('does not credit a gap in the telemetry', () => {
    // After a stall the vehicle may have been anywhere, so the gap is dropped
    // rather than integrated.
    const st = useCalStore.getState()
    st.magCalAttitude(0, 0, { rollRateRad: 0, pitchRateRad: 0, yawRateRad: Math.PI }, 1000)
    st.magCalAttitude(0, 0, { rollRateRad: 0, pitchRateRad: 0, yawRateRad: Math.PI }, 60000)
    expect(useCalStore.getState().magCal.turns.level ?? 0).toBe(0)
  })

  it('counts nothing at all unless a calibration is running', () => {
    useCalStore.getState().magCalReset()
    feed({ rate: { yawRateRad: Math.PI }, seconds: 10 })
    expect(useCalStore.getState().magCal.turns.level ?? 0).toBe(0)
  })

  it('reports which attitude the vehicle is in, for the highlight', () => {
    feed({ pitch: -Math.PI / 2, rate: { rollRateRad: 0.5 }, seconds: 0.2 })
    expect(useCalStore.getState().magCal.at).toBe('noseDown')
  })
})
