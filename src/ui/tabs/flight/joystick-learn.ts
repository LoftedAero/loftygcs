import { useEffect, useRef, useState } from 'react'
import { useJoystickStore } from '../../../stores/joystick-store'
import { CHANNELS, type JoystickConfig } from '../../../protocol/joystick'

/** The first channel above the sticks that nothing drives yet. */
export function nextFreeChannel(config: JoystickConfig): number {
  const used = new Set([...config.axes, ...config.buttons].map((m) => m.channel))
  for (let ch = 5; ch <= CHANNELS; ch++) if (!used.has(ch)) return ch
  return CHANNELS
}

/** How far an axis must travel from where it was to count as the one moved. */
const LEARN_TRAVEL = 0.5

export type Learnable = 'axis' | 'button'

/**
 * Learn: "move the control you want" rather than "pick axis 3", because the
 * browser's numbers mean nothing to anyone. Every read is compared with the
 * controls as they were when listening began, and the first that clearly
 * moved -- an axis travelling more than half its range, a button going
 * down -- is handed to the caller. One listener at a time: starting another
 * replaces it.
 */
export function useLearn() {
  const axes = useJoystickStore((s) => s.axes)
  const buttons = useJoystickStore((s) => s.buttons)
  const [target, setTarget] = useState<{ key: string; kind: Learnable } | null>(null)
  const found = useRef<((index: number) => void) | null>(null)
  const baseline = useRef<{ axes: number[]; buttons: boolean[] } | null>(null)

  useEffect(() => {
    if (!target) {
      baseline.current = null
      return
    }
    if (!baseline.current) {
      baseline.current = { axes: [...axes], buttons: [...buttons] }
      return
    }
    const base = baseline.current
    const index =
      target.kind === 'axis'
        ? axes.findIndex((v, i) => Math.abs(v - (base.axes[i] ?? v)) > LEARN_TRAVEL)
        : buttons.findIndex((b, i) => b && !base.buttons[i])
    if (index < 0) return
    const cb = found.current
    setTarget(null)
    cb?.(index)
  }, [axes, buttons, target])

  return {
    /** The key being listened for, or null. */
    listening: target?.key ?? null,
    start(key: string, kind: Learnable, onFound: (index: number) => void) {
      found.current = onFound
      baseline.current = null
      setTarget({ key, kind })
    },
    cancel() {
      setTarget(null)
    },
  }
}
