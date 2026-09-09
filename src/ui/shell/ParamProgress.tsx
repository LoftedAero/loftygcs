import { useParamStore } from '../../stores/param-store'

// A thin bar across the foot of the app bar while parameters are loading.
//
// QGroundControl overlays its toolbar the same way, and the reason it works
// is that a parameter download is the one long operation that is *not* about
// the screen you are on: it is started by connecting, by a reboot, and now by
// writing a parameter that gates others, and until it finishes every curated
// tab is showing an incomplete vehicle. A card on the Parameters tab says so
// to whoever is already there; the app bar says it wherever you are.
//
// Blue, not QGC's green, and not a free choice: this app already draws two
// progress bars (compass coverage, log download) and both are
// `--la-blue`, with the reason written next to one of them -- progress is
// activity, not a status verdict. Green here would mean "good".
export default function ParamProgress() {
  const progress = useParamStore((s) => s.progress)
  const loadState = useParamStore((s) => s.loadState)

  // `progress` covers a quiet refresh, which deliberately never touches
  // `loadState`; `loadState` covers the gap between asking and the first
  // packet, when there is nothing to report a fraction of yet.
  const running = progress !== null || loadState === 'downloading'
  if (!running) return null

  const total = progress?.total ?? 0
  const known = total > 0
  const pct = known ? Math.min(100, Math.round(((progress?.got ?? 0) / total) * 100)) : null

  return (
    <div
      className={known ? 'app-bar-progress' : 'app-bar-progress is-indeterminate'}
      role="progressbar"
      aria-label="Loading parameters"
      {...(pct === null ? {} : { 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 })}
      title={
        pct === null
          ? 'Loading parameters…'
          : `Loading parameters — ${progress?.got ?? 0} of ${total}`
      }
    >
      <div
        className="app-bar-progress__fill"
        {...(pct === null ? {} : { style: { width: `${pct}%` } })}
      />
    </div>
  )
}
