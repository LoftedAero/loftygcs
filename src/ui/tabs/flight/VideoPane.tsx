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
// already pushing RTP at. The label names both and the placeholder shows the
// first; two example links that filled the field in went, because they were
// orange text competing with Connect for the pane's one primary action.
//
// H.264 only, which is what essentially every airborne camera and companion
// computer produces. Credentials go in the URL -- rtsp://user:pass@host/path
// -- and are sent as an authentication header rather than in the request
// line. That used to be a paragraph under the field; it is what the code
// does, not something to read before connecting.
//
// Connect means "keep this stream on the HUD": a drop reconnects by itself
// until Disconnect (services/video.ts), and the one status line says what is
// playing, what it is doing, or why it is not.

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
        {/* Ghost, as the app bar's Disconnect is: stopping the picture is not
            destructive, and blue is for the controls that set something. */}
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

      {/* A browser can open neither an RTSP nor a raw UDP stream. Otherwise
          one line, always there -- what is happening, what is playing, or why
          it is not -- so a status arriving moves nothing. Red while the
          picture is down, retrying or not. */}
      {!desktop ? (
        <LaHint error>Network video needs the desktop app.</LaHint>
      ) : (
        <LaHint error={status.state === 'error' || status.state === 'retrying'}>
          {status.text || <>&nbsp;</>}
        </LaHint>
      )}
    </div>
  )
}
