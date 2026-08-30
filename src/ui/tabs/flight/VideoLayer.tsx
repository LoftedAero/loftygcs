import { useEffect, useRef, useState } from 'react'
import { videoService, type VideoStatus } from '../../../services/video'

// The HUD's background layer, drawing decoded frames.
//
// A canvas rather than a <video> element: the frames arrive as VideoFrame
// objects from WebCodecs, with no container or MediaStream to hand an
// element. Drawing them is one call, and it keeps the aspect handling here
// rather than fighting an element's own letterboxing.
//
// Frames are drawn as they arrive rather than on requestAnimationFrame: they
// come at the camera's rate, and waiting for the next frame callback would
// add up to a frame of latency to a picture someone is flying on.

export default function VideoLayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<VideoStatus>(videoService.current)

  useEffect(() => videoService.onStatus(setStatus), [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    return videoService.onFrame((frame) => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w === 0 || h === 0) return
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      // Letterboxed to the frame's own aspect: stretching a 16:9 feed into a
      // 4:3 panel makes the horizon in the picture disagree with the one
      // drawn over it, which is worse than bars.
      const fw = frame.displayWidth
      const fh = frame.displayHeight
      const scale = Math.min(canvas.width / fw, canvas.height / fh)
      const dw = fw * scale
      const dh = fh * scale
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(frame, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh)
    })
  }, [])

  return (
    <>
      <canvas ref={canvasRef} className="video-layer" />
      {status.state !== 'playing' && status.text && (
        <p className={`video-layer__note${status.state === 'error' ? ' is-error' : ''}`}>
          {status.text}
        </p>
      )}
    </>
  )
}
