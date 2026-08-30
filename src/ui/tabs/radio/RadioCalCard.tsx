import { useRef, useState } from 'react'
import { LaButton, LaCard, LaHint } from '../../components/La'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useParamStore } from '../../../stores/param-store'
import { useProfileLabels } from '../../../stores/guide-store'
import { connectionService } from '../../../services/connection'

// Radio calibration: watch the live RC_CHANNELS stream, record the extremes
// while the user exercises the sticks, then write RCn_MIN/MAX (and TRIM
// from the centered position at save time).
export default function RadioCalCard() {
  const channels = useVehicleStore((s) => s.rcChannels)
  const paramsReady = useParamStore((s) => s.loadState === 'ready')
  const { channelLabels } = useProfileLabels()
  const [recording, setRecording] = useState(false)
  const [status, setStatus] = useState('')
  const extremes = useRef<{ min: number; max: number }[]>([])

  // Track extremes on every render while recording -- render rate is the
  // snapshot rate (5 Hz), plenty for stick endpoints.
  if (recording) {
    channels.forEach((v, i) => {
      if (v <= 0) return
      const e = (extremes.current[i] ??= { min: v, max: v })
      if (v < e.min) e.min = v
      if (v > e.max) e.max = v
    })
  }

  const start = () => {
    extremes.current = []
    setStatus('Move all sticks, switches, and dials to their extremes, then center and save.')
    setRecording(true)
  }

  const save = async () => {
    setRecording(false)
    const trims = useVehicleStore.getState().rcChannels
    let written = 0
    const failed: string[] = []
    for (let i = 0; i < extremes.current.length; i++) {
      const e = extremes.current[i]
      // A channel that never moved past a trivial range wasn't exercised;
      // writing its resting value as MIN and MAX would break that channel.
      if (!e || e.max - e.min < 100) continue
      const n = i + 1
      try {
        await connectionService.setParamNow(`RC${n}_MIN`, e.min)
        await connectionService.setParamNow(`RC${n}_MAX`, e.max)
        const trim = trims[i]
        if (trim && trim > 0) await connectionService.setParamNow(`RC${n}_TRIM`, trim)
        written++
      } catch {
        failed.push(`RC${n}`)
      }
    }
    setStatus(
      failed.length
        ? `Saved ${written} channels; failed: ${failed.join(', ')}`
        : written
          ? `Saved min/max/trim for ${written} channel${written === 1 ? '' : 's'}.`
          : 'No channel moved enough to record — is the transmitter on?',
    )
  }

  return (
    <LaCard
      title="Radio"
      note="Live receiver input. Calibrate with the transmitter on and the vehicle disarmed."
    >
      {channels.length === 0 ? (
        <p className="app-placeholder">No RC input seen yet — turn the transmitter on.</p>
      ) : (
        channels.map((v, i) => (
          <div className="la-field" key={i}>
            <label className="la-field__label">
              {channelLabels[i + 1] ?? `Channel ${i + 1}`}{' '}
              <span className="la-field__unit">µs</span>
            </label>
            <div className="la-row rc-channel">
              <input
                className="la-slider la-slider--readout la-grow"
                type="range"
                min={800}
                max={2200}
                value={v || 800}
                disabled
                readOnly
              />
              <span className="la-readout rc-channel__value">{v || '—'}</span>
            </div>
          </div>
        ))
      )}
      <div className="la-row">
        {!recording ? (
          <LaButton variant="secondary" disabled={channels.length === 0} onClick={start}>
            Calibrate radio
          </LaButton>
        ) : (
          <LaButton variant="primary" disabled={!paramsReady} onClick={() => void save()}>
            Save calibration
          </LaButton>
        )}
        {recording && (
          <LaButton variant="ghost" onClick={() => setRecording(false)}>
            Cancel
          </LaButton>
        )}
      </div>
      <LaHint>{status}</LaHint>
    </LaCard>
  )
}
