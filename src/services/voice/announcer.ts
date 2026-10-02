// The voice callouts' glue: watches the stores outside React, runs the rules,
// and sends what they decide through the queue to speech or a beep, as each
// row is set in Preferences. Started once by App.

import { useConnectionStore } from '../../stores/connection-store'
import { useMissionStore } from '../../stores/mission-store'
import { useParamStore } from '../../stores/param-store'
import { calloutMode, calloutValue, usePreferencesStore } from '../../stores/preferences-store'
import { useTrafficStore } from '../../stores/traffic-store'
import { useVehicleStore, type StatusText } from '../../stores/vehicle-store'
import { videoService } from '../video'
import { beepKindOf, calloutDef, type BeepKind, type CalloutId } from './catalog'
import { AnnounceQueue } from './queue'
import { CalloutWatcher, type AppEvent, type Emission, type WatchConfig } from './rules'
import { speechEngine } from './speech'
import { forSpeech } from './speech-text'
import { playTone, stopTones } from './tones'

/** How often the rules look at the vehicle; also the settle time's resolution. */
const TICK_MS = 250

const PLAN_NAMES = { mission: 'Mission', fence: 'Fence', rally: 'Rally points' } as const

class Announcer {
  private watcher = new CalloutWatcher()
  private queue = new AnnounceQueue({
    speak: (text) => speechEngine().speak(text),
    beep: (kind) => playTone(kind, usePreferencesStore.getState().voice.tones[kind]),
    stop: () => {
      speechEngine().stop()
      stopTones()
    },
  })
  private timer: ReturnType<typeof setInterval> | null = null
  private unsubs: (() => void)[] = []
  /** The newest status message already looked at. */
  private lastText: StatusText | null = null

  start(): void {
    if (this.timer) return
    this.lastText = useVehicleStore.getState().statusTexts.at(-1) ?? null
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.unsubs.push(
      // Muting cuts off whatever is sounding.
      usePreferencesStore.subscribe((s, prev) => {
        if (prev.voice.enabled && !s.voice.enabled) this.queue.clear()
      }),
      useConnectionStore.subscribe((s, prev) => {
        if (s.phase === 'idle' && prev.phase !== 'idle') this.queue.clear()
      }),
      useParamStore.subscribe((s, prev) => {
        if (prev.loadState === 'downloading' && s.loadState === 'ready') this.event({ t: 'params' })
      }),
      useMissionStore.subscribe((s, prev) => {
        if (prev.transfer.kind !== 'busy' || s.transfer.kind === 'busy') return
        if (s.transfer.kind !== 'done' && s.transfer.kind !== 'error') return
        this.event({
          t: 'transfer',
          what: PLAN_NAMES[s.editing],
          dir: prev.transfer.dir,
          ok: s.transfer.kind === 'done',
        })
      }),
    )
    let videoWas = videoService.current.state
    this.unsubs.push(
      videoService.onStatus((st) => {
        if (videoWas === 'playing' && (st.state === 'retrying' || st.state === 'error')) {
          this.event({ t: 'video' })
        }
        videoWas = st.state
      }),
    )
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const u of this.unsubs) u()
    this.unsubs = []
    this.queue.clear()
  }

  /** Something the app did or saw: a refused command, a finished transfer. */
  event(e: AppEvent): void {
    // A refusal's reason may be waiting in the message feed; read it first.
    this.drainMessages(Date.now())
    this.emit(this.watcher.event(e, Date.now()))
  }

  /** Plays both beeps and a phrase, for the Test button. */
  test(): void {
    const now = Date.now()
    this.queue.push({ text: null, beep: 'info', pri: 'info', key: 'test:info', at: now })
    this.queue.push({ text: null, beep: 'warn', pri: 'info', key: 'test:warn', at: now })
    this.queue.push({ text: 'Voice test', beep: 'info', pri: 'info', key: 'test:voice', at: now })
  }

  /** One beep, for previewing a tone as it is chosen. */
  preview(kind: BeepKind, toneId: string): void {
    void playTone(kind, toneId)
  }

  private config(): WatchConfig {
    const prefs = usePreferencesStore.getState()
    return {
      units: prefs.units,
      value: (id: CalloutId) => calloutValue(prefs.voice, id),
      repeatS: prefs.voice.repeatS,
    }
  }

  private tick(): void {
    const now = Date.now()
    this.drainMessages(now)
    const input = {
      phase: useConnectionStore.getState().phase,
      v: useVehicleStore.getState(),
      traffic: useTrafficStore.getState().targets,
    }
    this.emit(this.watcher.update(input, now, this.config()))
  }

  /** Hands every status message newer than the last one seen to the rules. */
  private drainMessages(now: number): void {
    const texts = useVehicleStore.getState().statusTexts
    let i = texts.length
    // Back to the last one seen; if it has scrolled out of the capped feed,
    // or the feed was cleared, every message is new.
    while (i > 0 && texts[i - 1] !== this.lastText) i--
    const fresh = texts.slice(i)
    if (!fresh.length) return
    this.lastText = fresh[fresh.length - 1]!
    for (const st of fresh) this.emit(this.watcher.message(st, now))
  }

  private emit(list: Emission[]): void {
    if (!list.length) return
    const voice = usePreferencesStore.getState().voice
    if (!voice.enabled) return
    const now = Date.now()
    for (const e of list) {
      const mode = calloutMode(voice, e.id)
      if (mode === 'off') continue
      const def = calloutDef(e.id)
      this.queue.push({
        text: mode === 'voice' ? forSpeech(e.text) : null,
        beep: e.beep ?? beepKindOf(def),
        pri: def.pri,
        key: e.key ?? e.id,
        at: now,
      })
    }
  }
}

export const announcer = new Announcer()

/** Reports an app event to the callouts. */
export function announce(e: AppEvent): void {
  announcer.event(e)
}
