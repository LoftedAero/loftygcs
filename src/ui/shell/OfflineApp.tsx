import { startPwa, usePwaStore } from '../../services/pwa'
import { LaButton, LaHint } from '../components/La'

export default function OfflineApp() {
  const state = usePwaStore((s) => s.state)
  const updateWaiting = usePwaStore((s) => s.updateWaiting)
  if (state === 'unavailable') return null
  const label = {
    installing: 'Saving app for offline use…',
    ready: 'App ready offline',
    error: 'Offline app unavailable',
  }[state]
  return (
    <section className="prefs__group">
      <h3 className="prefs__head">Offline app</h3>
      <div className="prefs__offline">
        <span role="status">{label}</span>
        <LaButton variant="secondary" disabled={state !== 'error'} onClick={() => void startPwa()}>
          Retry
        </LaButton>
      </div>
      <LaHint>
        {updateWaiting
          ? 'Update saved. Close all app windows to apply.'
          : state === 'error'
            ? 'Check internet access and available browser storage.'
            : '\u00a0'}
      </LaHint>
    </section>
  )
}
