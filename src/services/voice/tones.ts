// The info and warning beeps, synthesized with Web Audio so there are no sound
// files to ship and the same code runs in the browser, Electron and the
// Android WebView (which starts an AudioContext without a tap).
//
// Each is a cockpit-style sound, approximated from published descriptions
// rather than recordings. They follow the FAA's guidance for flight-deck aural
// alerts (AC 25.1322-1): one tone for caution and one for warning, differing in
// more than one way, between 200 and 4500 Hz, with soft onsets rather than a
// click.

import type { BeepKind } from './catalog'

type Play = (ctx: BaseAudioContext, at: number) => void

interface Tone {
  id: string
  label: string
  /** Where the sound comes from, for the picker. */
  from: string
  /** How long it sounds, so the queue can wait for it. */
  durationMs: number
  play: Play
}

/** A struck chime: a few inharmonic partials, each decaying on its own. */
function chime(ctx: BaseAudioContext, at: number, hz: number, decayS: number, level: number) {
  const bus = ctx.createGain()
  bus.gain.value = level
  bus.connect(ctx.destination)
  for (const [ratio, amp, decay] of [
    [1, 1, 1],
    [2.0, 0.45, 0.7],
    [3.01, 0.22, 0.5],
    [4.16, 0.12, 0.35],
  ] as const) {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.value = hz * ratio
    const end = at + decayS * decay
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(amp, at + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0008, end)
    o.connect(g).connect(bus)
    o.start(at)
    o.stop(end + 0.05)
  }
}

/** A steady tone with 20 ms edges. */
function tone(
  ctx: BaseAudioContext,
  at: number,
  hz: number,
  ms: number,
  level: number,
  type: OscillatorType = 'sine',
) {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  const end = at + ms / 1000
  o.type = type
  o.frequency.value = hz
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(level, at + 0.02)
  g.gain.setValueAtTime(level, end - 0.025)
  g.gain.linearRampToValueAtTime(0, end)
  o.connect(g).connect(ctx.destination)
  o.start(at)
  o.stop(end + 0.02)
}

const INFO_TONES: Tone[] = [
  {
    id: 'soft-beep',
    label: 'Soft beep',
    from: 'Garmin advisory beep',
    durationMs: 150,
    play: (c, t) => tone(c, t, 1000, 120, 0.32),
  },
  {
    id: 'single-chime',
    label: 'Single chime',
    from: 'Airbus master caution',
    durationMs: 850,
    play: (c, t) => chime(c, t, 1047, 1.1, 0.32),
  },
  {
    id: 'hi-lo',
    label: 'Hi-lo chime',
    from: 'Boeing crew call',
    durationMs: 1050,
    play: (c, t) => {
      chime(c, t, 1175, 0.9, 0.28)
      chime(c, t + 0.32, 880, 1.0, 0.28)
    },
  },
  {
    id: 'c-chord',
    label: 'C-chord',
    from: 'Airbus altitude alert',
    durationMs: 730,
    play: (c, t) => {
      for (const hz of [523.25, 659.25, 783.99]) tone(c, t, hz, 700, 0.12)
    },
  },
  {
    id: 'ding',
    label: 'High ding',
    from: 'Business-jet advisory',
    durationMs: 520,
    play: (c, t) => chime(c, t, 1568, 0.7, 0.26),
  },
]

const WARN_TONES: Tone[] = [
  {
    id: 'beeper',
    label: 'Caution beeper',
    from: 'Boeing master caution',
    durationMs: 440,
    play: (c, t) => {
      for (let i = 0; i < 3; i++) tone(c, t + i * 0.16, 1250, 90, 0.42, 'triangle')
    },
  },
  {
    id: 'triple-chime',
    label: 'Triple chime',
    from: 'Airbus repetitive chime',
    durationMs: 1020,
    play: (c, t) => {
      for (let i = 0; i < 3; i++) chime(c, t + i * 0.28, 1047, 0.6, 0.3)
    },
  },
  {
    id: 'cricket',
    label: 'Cricket',
    from: 'Airbus cricket',
    durationMs: 550,
    play: (c, t) => {
      for (let n = 0; n < 2; n++) {
        for (let k = 0; k < 6; k++) tone(c, t + n * 0.32 + k * 0.035, 3200, 22, 0.34)
      }
    },
  },
  {
    id: 'warbler',
    label: 'Warbler',
    from: 'Two-pitch warble',
    durationMs: 750,
    play: (c, t) => {
      const o = c.createOscillator()
      const g = c.createGain()
      const end = t + 0.72
      o.type = 'triangle'
      for (let k = 0; k < 9; k++) o.frequency.setValueAtTime(k % 2 ? 1400 : 950, t + k * 0.08)
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.4, t + 0.02)
      g.gain.setValueAtTime(0.4, end - 0.03)
      g.gain.linearRampToValueAtTime(0, end)
      o.connect(g).connect(c.destination)
      o.start(t)
      o.stop(end + 0.02)
    },
  },
  {
    id: 'two-tone',
    label: 'Two-tone falling',
    from: 'Generic two-tone alert',
    durationMs: 430,
    play: (c, t) => {
      tone(c, t, 988, 140, 0.4)
      tone(c, t + 0.2, 740, 200, 0.4)
    },
  },
]

export const TONES: Record<BeepKind, readonly Tone[]> = { info: INFO_TONES, warn: WARN_TONES }

export const TONE_IDS = {
  info: INFO_TONES.map((t) => t.id),
  warn: WARN_TONES.map((t) => t.id),
} as const

export interface ToneChoice {
  info: string
  warn: string
}

export const DEFAULT_TONES: ToneChoice = { info: 'soft-beep', warn: 'beeper' }

export function toneOf(kind: BeepKind, id: string): Tone {
  return TONES[kind].find((t) => t.id === id) ?? TONES[kind][0]!
}

let ctx: AudioContext | null = null

/**
 * Plays a tone and resolves when it has finished. Never rejects: a page
 * without Web Audio simply stays quiet.
 */
export function playTone(kind: BeepKind, id: string): Promise<void> {
  const t = toneOf(kind, id)
  try {
    const AC =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return Promise.resolve()
    ctx ??= new AC()
    void ctx.resume()
    t.play(ctx, ctx.currentTime + 0.03)
  } catch {
    return Promise.resolve()
  }
  return new Promise((r) => setTimeout(r, t.durationMs + 60))
}

/** Silences anything still sounding, for a critical alert that interrupts. */
export function stopTones(): void {
  if (!ctx) return
  const old = ctx
  ctx = null
  void old.close().catch(() => {})
}
