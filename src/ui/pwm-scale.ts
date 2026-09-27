// One scale for every pulse-width bar, so a stick on the Radio tab and the
// servo it moves on the Outputs tab line up. Wider than the nominal 1000-2000
// because travel is often set past it.

export const PWM_SCALE_MIN = 900
export const PWM_SCALE_MAX = 2100

/** Where a pulse width falls on the scale, 0-100, clamped. */
export function pwmPct(us: number): number {
  return Math.max(0, Math.min(100, ((us - PWM_SCALE_MIN) / (PWM_SCALE_MAX - PWM_SCALE_MIN)) * 100))
}
