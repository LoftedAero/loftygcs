import { useParamStore } from '../../stores/param-store'

// A thin bar across the foot of the app bar while parameters are loading, as
// QGroundControl does. A download starts on connect, on reboot, or after
// writing a parameter that gates others, and every curated tab is incomplete
// until it finishes, so it is shown wherever you are.
//
// Blue like the app's other progress bars: progress is activity, not status.
export default function ParamProgress() {
  const progress = useParamStore((s) => s.progress)
  const loadState = useParamStore((s) => s.loadState)

  // `progress` covers a quiet refresh, which never touches `loadState`;
  // `loadState` covers the gap before the first packet.
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
