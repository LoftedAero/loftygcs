import { useEffect, useState } from 'react'
import { LaButton, LaHint } from '../../components/La'
import { useFlightLayoutStore } from '../../../stores/flight-layout-store'
import { videoService, type VideoStatus } from '../../../services/video'

// The HUD's video source, as a pane rather than a dialog.
//
// It was a modal reached from the View menu, which put it two levels down
// from a screen where it is one of the things you set up before flying. It
// is also not a question with an answer -- it is a connection you watch, so
// it wants somewhere to keep reporting from rather than somewhere to be
// dismissed. The lower pane is that place, beside the camera controls that
// point the thing this is showing.
//
// Two forms, because those are the two a vehicle actually offers: an RTSP
// stream from a camera or companion computer, and a UDP port something is
// already pushing RTP at.

const EXAMPLES = [
  { label: 'RTSP camera', value: 'rtsp://10.66.0.2:8554/stream' },
  { label: 'RTP over UDP', value: 'udp://:5600' },
]

export default function VideoPane() {
  const url = useFlightLayoutStore((s) => s.videoUrl)
  const setUrl = useFlightLayoutStore((s) => s.setVideoUrl)
  const [draft, setDraft] = useState(url)
  const [status, setStatus] = useState<VideoStatus>(videoService.current)

  useEffect(() => videoService.onStatus(setStatus), [])

  const desktop = videoService.supported()
  const live = status.state !== 'idle' && status.state !== 'error'
  const connect = () => {
    setUrl(draft.trim())
    void videoService.open(draft.trim())
  }

  return (
    <div className="video-pane">
      <div className="video-pane__form">
        <label className="la-field la-field--stacked">
          <span className="la-field__label">
            Stream URL <span className="la-field__unit">rtsp:// or udp://</span>
          </span>
          <input
            className="la-input"
            type="text"
            value={draft}
            spellCheck={false}
            placeholder="rtsp://10.66.0.2:8554/stream"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim() !== '' && desktop) connect()
            }}
          />
        </label>
        {live ? (
          <LaButton variant="secondary" onClick={() => void videoService.close()}>
            Disconnect
          </LaButton>
        ) : (
          <LaButton variant="primary" disabled={!desktop || draft.trim() === ''} onClick={connect}>
            Connect
          </LaButton>
        )}
      </div>

      <div className="la-row la-row--wrap video-examples">
        {EXAMPLES.map((e) => (
          <button
            key={e.value}
            type="button"
            className="la-link-btn"
            onClick={() => setDraft(e.value)}
          >
            {e.label}
          </button>
        ))}
      </div>

      {!desktop && (
        <LaHint error>
          Network video needs the desktop app. A browser cannot open an RTSP or raw UDP stream, and
          neither can be reached from a page.
        </LaHint>
      )}
      {status.text && <LaHint error={status.state === 'error'}>{status.text}</LaHint>}

      <p className="app-placeholder">
        H.264 only, which is what essentially every airborne camera and companion computer produces.
        Credentials go in the URL — <code>rtsp://user:pass@host:554/stream</code> — and are sent as
        an authentication header rather than in the request itself.
      </p>
    </div>
  )
}
