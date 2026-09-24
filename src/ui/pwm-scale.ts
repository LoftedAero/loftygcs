// One scale for every picture of a pulse width, so a stick on the Radio tab and
// the servo it moves on the Outputs tab sit at the same place on their bars.
// Wider than the 1000-2000 a receiver nominally sends, because travel is set
// past it and a value pinned against the end of a bar says nothing about how
// far past.

export const PWM_SCALE_MIN = 900
export const PWM_SCALE_MAX = 2100

/** Where a pulse width falls on the scale, 0-100, clamped. */
export function pwmPct(us: number): number {
  return Math.max(0, Math.min(100, ((us - PWM_SCALE_MIN) / (PWM_SCALE_MAX - PWM_SCALE_MIN)) * 100))
}
