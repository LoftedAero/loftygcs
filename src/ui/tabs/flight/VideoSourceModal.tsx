import { useEffect, useState } from 'react'
import { LaButton, LaHint, LaModal } from '../../components/La'
import { videoService, type VideoStatus } from '../../../services/video'

// Where the video source is entered. Two forms, because those are the two a
// vehicle actually offers: an RTSP stream from a camera or companion
// computer, and a UDP port that something is already pushing RTP at.

const EXAMPLES = [
  { label: 'RTSP camera', value: 'rtsp://10.66.0.2:8554/stream' },
  { label: 'RTP over UDP', value: 'udp://:5600' },
]

export interface VideoSourceModalProps {
  open: boolean
  url: string
  onUrl: (url: string) => void
  onClose: () => void
}

export default function VideoSourceModal({ open, url, onUrl, onClose }: VideoSourceModalProps) {
  const [draft, setDraft] = useState(url)
  const [status, setStatus] = useState<VideoStatus>(videoService.current)

  useEffect(() => videoService.onStatus(setStatus), [])
  useEffect(() => {
    if (open) setDraft(url)
  }, [open, url])

  const desktop = videoService.supported()
  const connect = () => {
    onUrl(draft.trim())
    void videoService.open(draft.trim())
  }

  return (
    <LaModal
      open={open}
      title="HUD video"
      actions={
        <>
          <LaButton variant="ghost" onClick={onClose}>
            Close
          </LaButton>
          {status.state === 'idle' || status.state === 'error' ? (
            <LaButton
              variant="primary"
              disabled={!desktop || draft.trim() === ''}
              onClick={connect}
            >
              Connect
            </LaButton>
          ) : (
            <LaButton variant="secondary" onClick={() => void videoService.close()}>
              Disconnect
            </LaButton>
          )}
        </>
      }
    >
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
    </LaModal>
  )
}
