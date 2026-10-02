// One sound at a time, most urgent first, and never late.
//
// Critical stops whatever is playing. Warnings go ahead of information.
// Anything that has waited too long is dropped rather than said late: a
// callout about a state the aircraft has already left is worse than none
// (QGroundControl's early queue fell so far behind it spoke stale state).

import type { BeepKind, CalloutPriority } from './catalog'

export interface QueueItem {
  /** Words to speak, or null for a beep. */
  text: string | null
  beep: BeepKind
  pri: CalloutPriority
  /** Identical keys already waiting, or just played, are not queued again. */
  key: string
  at: number
}

export interface QueueSinks {
  speak(text: string): Promise<void>
  beep(kind: BeepKind): Promise<void>
  /** Cut off whatever is sounding. */
  stop(): void
}

const RANK: Record<CalloutPriority, number> = { crit: 0, warn: 1, info: 2 }

/** How long an item may wait before it is no longer worth saying. */
const MAX_WAIT_MS: Record<CalloutPriority, number> = { crit: 30000, warn: 15000, info: 5000 }

/** Most items waiting at once; the least urgent and oldest go first. */
const MAX_LENGTH = 6

/** An identical key played this recently is not repeated (two beeps for one event). */
const REPLAY_GAP_MS = 1000

export class AnnounceQueue {
  private items: QueueItem[] = []
  private playing: QueueItem | null = null
  /** Bumped by an interruption, so a cut-off item does not start the next one twice. */
  private gen = 0
  private lastPlayed = new Map<string, number>()

  constructor(
    private sinks: QueueSinks,
    private now: () => number = () => Date.now(),
  ) {}

  push(item: QueueItem): void {
    const now = this.now()
    if (this.items.some((i) => i.key === item.key)) return
    if (this.playing?.key === item.key) return
    const last = this.lastPlayed.get(item.key)
    if (last !== undefined && now - last < REPLAY_GAP_MS) return

    if (item.pri === 'crit' && this.playing && this.playing.pri !== 'crit') {
      this.gen++
      this.playing = null
      this.sinks.stop()
    }
    this.items.push(item)
    this.items.sort((a, b) => RANK[a.pri] - RANK[b.pri] || a.at - b.at)
    while (this.items.length > MAX_LENGTH) {
      // The last is the least urgent; among equals, the newest. Drop the
      // oldest of the least urgent instead.
      const worst = RANK[this.items[this.items.length - 1]!.pri]
      const idx = this.items.findIndex((i) => RANK[i.pri] === worst)
      this.items.splice(idx, 1)
    }
    if (!this.playing) void this.next()
  }

  /** Drops everything, including what is sounding (muting, disconnecting). */
  clear(): void {
    this.items = []
    if (this.playing) {
      this.gen++
      this.playing = null
      this.sinks.stop()
    }
  }

  /** What is waiting, for tests. */
  get pending(): readonly QueueItem[] {
    return this.items
  }

  get current(): QueueItem | null {
    return this.playing
  }

  private async next(): Promise<void> {
    const now = this.now()
    this.items = this.items.filter((i) => now - i.at <= MAX_WAIT_MS[i.pri])
    const item = this.items.shift()
    if (!item) return
    const gen = this.gen
    this.playing = item
    for (const [key, at] of this.lastPlayed)
      if (now - at > REPLAY_GAP_MS) this.lastPlayed.delete(key)
    this.lastPlayed.set(item.key, now)
    try {
      await (item.text === null ? this.sinks.beep(item.beep) : this.sinks.speak(item.text))
    } finally {
      if (gen === this.gen) {
        this.playing = null
        void this.next()
      } else if (!this.playing) {
        void this.next()
      }
    }
  }
}
