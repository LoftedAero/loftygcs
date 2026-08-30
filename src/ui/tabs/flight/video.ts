// The seam for HUD video. No backend yet, deliberately: which one is worth
// building depends on what the aircraft actually streams, and the layered HUD
// is what has to exist first either way.
//
// What each option would mean, recorded here so the decision does not have to
// be re-derived later:
//
//   mjpeg   An <img> pointed at an MJPEG endpoint. Works in both the browser
//           and desktop builds with no native dependency, and could ship in a
//           day. Costs bandwidth and adds latency, but needs nothing else.
//
//   webrtc  An <video> fed by RTCPeerConnection. Also works in both builds,
//           and is the only low-latency option the browser can do unaided.
//           Needs the camera or a companion to speak WebRTC, plus signalling.
//
//   rtsp    What most ArduPilot setups actually produce, and what a browser
//           cannot consume. Electron would spawn GStreamer to bridge it into
//           one of the two above; the browser build would have to say the
//           source is unavailable rather than pretend.
//
// Whatever arrives, it renders into .flight-hud__background beneath the
// canvas, so the horizon and overlay switches keep working unchanged.

export type VideoSourceKind = 'none' | 'mjpeg' | 'webrtc' | 'rtsp'

export interface VideoSource {
  kind: VideoSourceKind
  /** Endpoint for the kinds that have one. */
  url?: string
}

export const NO_VIDEO: VideoSource = { kind: 'none' }

/**
 * Whether the running build could display this source at all.
 *
 * RTSP needs a native bridge, so it can only work in the desktop build; the
 * browser has to say so rather than showing a dead panel.
 */
export function isSourceSupported(kind: VideoSourceKind, isElectron: boolean): boolean {
  return kind === 'rtsp' ? isElectron : true
}
