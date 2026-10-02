// Text to speech: the browser's speechSynthesis on the desktop app and the web
// app, and the Android app's native engine (android/.../SpeechPlugin.java),
// since Android's WebView has no speechSynthesis at all (checked on the
// Radiomaster AX12). Both resolve when a phrase has finished, so the queue can
// pace itself, and neither rejects: speech that cannot happen is skipped.
import { Capacitor, registerPlugin } from '@capacitor/core'

export interface SpeechEngine {
  speak(text: string): Promise<void>
  stop(): void
}

interface SpeechPlugin {
  speak(opts: { text: string }): Promise<void>
  stop(): Promise<void>
}

/**
 * How long a phrase may take before the queue moves on anyway. Some engines
 * never fire their end event; a stuck queue would silence every alert after.
 */
function patienceMs(text: string): number {
  return 3000 + text.length * 120
}

function withPatience(text: string, run: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, patienceMs(text))
    run()
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer)
        resolve()
      })
  })
}

function nativeEngine(): SpeechEngine {
  const plugin = registerPlugin<SpeechPlugin>('Speech')
  return {
    speak: (text) => withPatience(text, () => plugin.speak({ text })),
    stop: () => void plugin.stop().catch(() => {}),
  }
}

/** A local English voice where there is one, so speech works with no network. */
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices()
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'))
  return (
    english.find((v) => v.localService && v.lang === 'en-US') ??
    english.find((v) => v.localService) ??
    english[0] ??
    null
  )
}

function webEngine(): SpeechEngine {
  return {
    speak: (text) =>
      withPatience(
        text,
        () =>
          new Promise<void>((resolve) => {
            const u = new SpeechSynthesisUtterance(text)
            const voice = pickVoice()
            if (voice) u.voice = voice
            u.rate = 1.05
            u.onend = () => resolve()
            u.onerror = () => resolve()
            speechSynthesis.speak(u)
          }),
      ),
    stop: () => speechSynthesis.cancel(),
  }
}

const silent: SpeechEngine = { speak: () => Promise.resolve(), stop: () => {} }

let engine: SpeechEngine | null = null

export function speechEngine(): SpeechEngine {
  if (engine) return engine
  if (Capacitor.isNativePlatform()) engine = nativeEngine()
  else if (typeof window !== 'undefined' && 'speechSynthesis' in window) engine = webEngine()
  else engine = silent
  return engine
}
