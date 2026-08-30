// HUD video in the renderer: take the compressed bitstream the main process
// forwards, decode it with WebCodecs, and hand frames to whoever is drawing.
//
// WebCodecs rather than a <video> element because there is no container here
// to give one -- just access units off the wire. VideoDecoder takes exactly
// that, and uses the same hardware decoder the element would.

export type VideoState = 'idle' | 'connecting' | 'playing' | 'error'

export interface VideoStatus {
  state: VideoState
  /** What to show the user: a step, or why it stopped. */
  text: string
}

type FrameSink = (frame: VideoFrame) => void
type StatusSink = (status: VideoStatus) => void

class VideoService {
  private decoder: VideoDecoder | null = null
  private unsubscribe: (() => void)[] = []
  private frameSinks = new Set<FrameSink>()
  private statusSinks = new Set<StatusSink>()
  private status: VideoStatus = { state: 'idle', text: '' }
  /** Frames before the first keyframe decode into nothing useful. */
  private sawKeyframe = false

  get current(): VideoStatus {
    return this.status
  }

  onFrame(sink: FrameSink): () => void {
    this.frameSinks.add(sink)
    return () => this.frameSinks.delete(sink)
  }

  onStatus(sink: StatusSink): () => void {
    this.statusSinks.add(sink)
    sink(this.status)
    return () => this.statusSinks.delete(sink)
  }

  private setStatus(state: VideoState, text: string) {
    this.status = { state, text }
    for (const s of this.statusSinks) s(this.status)
  }

  supported(): boolean {
    return typeof window !== 'undefined' && 'VideoDecoder' in window && !!window.loftgcs?.video
  }

  async open(url: string): Promise<void> {
    await this.close()
    const bridge = window.loftgcs?.video
    if (!bridge) {
      this.setStatus('error', 'Video needs the desktop app: the browser cannot open a network stream.')
      return
    }
    if (!('VideoDecoder' in window)) {
      this.setStatus('error', 'This build has no WebCodecs decoder.')
      return
    }
    this.setStatus('connecting', 'Opening…')

    this.unsubscribe.push(
      bridge.onStatus((s) => {
        if (s.error) this.setStatus('error', s.text)
        else if (s.closed) this.setStatus('idle', '')
        else if (this.status.state !== 'playing') this.setStatus('connecting', s.text)
      }),
      bridge.onReady((info) => this.configure(info.codec)),
      bridge.onUnit((u) => this.decode(u)),
    )

    const result = await bridge.open(url)
    if (!result.ok) {
      this.setStatus('error', result.error)
      await this.close()
    }
  }

  private configure(codec: string) {
    this.dropDecoder()
    this.sawKeyframe = false
    const decoder = new VideoDecoder({
      output: (frame) => {
        if (this.status.state !== 'playing') this.setStatus('playing', '')
        if (this.frameSinks.size === 0) {
          // Nothing is drawing; a frame that is not closed leaks its buffer
          // and the decoder stalls once its pool is exhausted.
          frame.close()
          return
        }
        for (const sink of this.frameSinks) sink(frame)
        frame.close()
      },
      error: (err) => this.setStatus('error', err.message),
    })
    // No description: the bitstream is Annex-B, which is what the
    // depayloader produces and what VideoDecoder assumes when none is given.
    decoder.configure({ codec, optimizeForLatency: true })
    this.decoder = decoder
  }

  private decode(u: { data: Uint8Array; keyframe: boolean; timestamp: number }) {
    const decoder = this.decoder
    if (!decoder || decoder.state !== 'configured') return
    if (!this.sawKeyframe) {
      if (!u.keyframe) return
      this.sawKeyframe = true
    }
    try {
      decoder.decode(
        new EncodedVideoChunk({
          type: u.keyframe ? 'key' : 'delta',
          // RTP timestamps for H.264 run at 90 kHz; WebCodecs wants µs.
          timestamp: Math.round((u.timestamp / 90000) * 1e6),
          data: u.data,
        }),
      )
    } catch (err) {
      this.setStatus('error', err instanceof Error ? err.message : 'Decode failed')
    }
  }

  private dropDecoder() {
    const decoder = this.decoder
    this.decoder = null
    if (!decoder) return
    try {
      if (decoder.state !== 'closed') decoder.close()
    } catch {
      // Already torn down.
    }
  }

  async close(): Promise<void> {
    for (const off of this.unsubscribe) off()
    this.unsubscribe = []
    this.dropDecoder()
    await window.loftgcs?.video?.close().catch(() => undefined)
    this.setStatus('idle', '')
  }
}

export const videoService = new VideoService()
