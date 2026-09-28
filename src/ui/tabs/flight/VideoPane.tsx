import { useEffect, useState } from 'react'
import { LaButton, LaHint } from '../../components/La'
import { useFlightLayoutStore } from '../../../stores/flight-layout-store'
import { videoService, type VideoStatus } from '../../../services/video'

// The HUD's video source. A pane rather than a dialog, because it is a
// connection that keeps reporting status.
//
// Two forms: an RTSP stream from a camera or companion computer, or a UDP
// port receiving RTP. H.264 only. Credentials in the URL
// (rtsp://user:pass@host/path) are sent as an authentication header.
//
// Connect keeps the stream on the HUD, reconnecting after a drop until
// Disconnect (services/video.ts).

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
        {/* Ghost, like the app bar's Disconnect. */}
        {live ? (
          <LaButton variant="ghost" onClick={() => void videoService.close()}>
            Disconnect
          </LaButton>
        ) : (
          <LaButton variant="primary" disabled={!desktop || draft.trim() === ''} onClick={connect}>
            Connect
          </LaButton>
        )}
      </div>

      {/* A browser can open neither RTSP nor raw UDP. Otherwise one status
          line, always rendered so nothing moves, red while the picture is
          down. */}
      {!desktop ? (
        <LaHint error>Network video requires the desktop app.</LaHint>
      ) : (
        <LaHint error={status.state === 'error' || status.state === 'retrying'}>
          {status.text || <>&nbsp;</>}
        </LaHint>
      )}
    </div>
  )
}
