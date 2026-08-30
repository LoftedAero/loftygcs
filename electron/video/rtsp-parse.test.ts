import { describe, expect, it } from 'vitest'
import {
  authorization,
  parseChallenge,
  parseResponse,
  parseRtspUrl,
  parseSdp,
  resolveControl,
} from './rtsp-parse'

describe('parseResponse', () => {
  it('reads the status, headers and body', () => {
    const r = parseResponse(
      'RTSP/1.0 200 OK\r\nCSeq: 2\r\nContent-Type: application/sdp\r\n\r\nv=0\r\n',
    )!
    expect(r.status).toBe(200)
    expect(r.reason).toBe('OK')
    expect(r.headers['content-type']).toBe('application/sdp')
    expect(r.body).toBe('v=0\r\n')
  })

  it('lower-cases header names, which cameras spell however they like', () => {
    const r = parseResponse('RTSP/1.0 200 OK\r\nSESSION: 12345;timeout=60\r\n\r\n')!
    expect(r.headers['session']).toBe('12345;timeout=60')
  })

  it('rejects anything that is not an RTSP status line', () => {
    expect(parseResponse('HTTP/1.1 200 OK\r\n\r\n')).toBeNull()
    expect(parseResponse('garbage')).toBeNull()
  })
})

describe('parseSdp', () => {
  // Trimmed from a real camera's DESCRIBE.
  const SDP = [
    'v=0',
    'o=- 1 1 IN IP4 10.66.0.2',
    's=Session',
    'c=IN IP4 0.0.0.0',
    't=0 0',
    'm=video 0 RTP/AVP 96',
    'a=rtpmap:96 H264/90000',
    'a=fmtp:96 packetization-mode=1;sprop-parameter-sets=Z0LgHtoCgPRA,aM4wpIA=',
    'a=control:trackID=0',
  ].join('\r\n')

  it('finds the video track and its payload type', () => {
    const t = parseSdp(SDP)!
    expect(t.payloadType).toBe(96)
    expect(t.encoding).toBe('H264')
    expect(t.control).toBe('trackID=0')
  })

  it('decodes the parameter sets, so the decoder can start before packet one', () => {
    const t = parseSdp(SDP)!
    // Z0LgHtoCgPRA decodes to an SPS whose first byte is a type-7 NAL header.
    expect((t.sps?.[0] ?? 0) & 0x1f).toBe(7)
    expect((t.pps?.[0] ?? 0) & 0x1f).toBe(8)
  })

  it('ignores media sections after the video one', () => {
    // An audio track's control URL must not be used to SETUP the video.
    const withAudio = `${SDP}\r\nm=audio 0 RTP/AVP 97\r\na=control:trackID=1`
    expect(parseSdp(withAudio)!.control).toBe('trackID=0')
  })

  it('returns null when there is no video at all', () => {
    expect(parseSdp('v=0\r\nm=audio 0 RTP/AVP 97\r\na=control:trackID=1')).toBeNull()
  })
})

describe('resolveControl', () => {
  const base = 'rtsp://10.66.0.2:8554/stream'

  it('hangs a relative control off the stream URL', () => {
    expect(resolveControl(base, 'trackID=0')).toBe('rtsp://10.66.0.2:8554/stream/trackID=0')
  })

  it('takes an absolute control as it is', () => {
    // Cameras are inconsistent about this, and using the wrong one gets a
    // 454 Session Not Found that looks like a stream problem.
    expect(resolveControl(base, 'rtsp://10.66.0.2:8554/other/trackID=9')).toBe(
      'rtsp://10.66.0.2:8554/other/trackID=9',
    )
  })

  it('treats * and empty as the stream URL itself', () => {
    expect(resolveControl(base, '*')).toBe(base)
    expect(resolveControl(base, '')).toBe(base)
  })

  it('does not double the slash when the base ends in one', () => {
    expect(resolveControl('rtsp://h/s/', 'trackID=0')).toBe('rtsp://h/s/trackID=0')
  })
})

describe('authentication', () => {
  it('reads a digest challenge', () => {
    const c = parseChallenge('Digest realm="Cam", nonce="abc123", stale="FALSE"')!
    expect(c).toEqual({ scheme: 'digest', realm: 'Cam', nonce: 'abc123' })
  })

  it('reads a basic challenge', () => {
    expect(parseChallenge('Basic realm="Cam"')).toEqual({ scheme: 'basic', realm: 'Cam' })
  })

  it('gives up on a scheme it cannot answer rather than guessing', () => {
    expect(parseChallenge('Bearer realm="x"')).toBeNull()
    expect(parseChallenge(undefined)).toBeNull()
  })

  it('computes the digest response the RFC specifies', () => {
    // HA1 = md5(user:realm:pass), HA2 = md5(method:uri),
    // response = md5(HA1:nonce:HA2). Checked against those by hand.
    const header = authorization(
      { scheme: 'digest', realm: 'Cam', nonce: 'abc123' },
      'DESCRIBE',
      'rtsp://h/s',
      'admin',
      'secret',
    )!
    expect(header).toContain('username="admin"')
    expect(header).toContain('nonce="abc123"')
    expect(header).toMatch(/response="[0-9a-f]{32}"/)
  })

  it('encodes basic credentials', () => {
    expect(authorization({ scheme: 'basic', realm: 'C' }, 'X', 'u', 'a', 'b')).toBe(
      `Basic ${Buffer.from('a:b').toString('base64')}`,
    )
  })

  it('sends nothing when there are no credentials to send', () => {
    expect(authorization({ scheme: 'basic', realm: 'C' }, 'X', 'u', '', '')).toBeNull()
  })
})

describe('parseRtspUrl', () => {
  it('splits out host and port, defaulting to 554', () => {
    expect(parseRtspUrl('rtsp://10.66.0.2/stream')).toMatchObject({
      host: '10.66.0.2',
      port: 554,
    })
    expect(parseRtspUrl('rtsp://10.66.0.2:8554/stream')).toMatchObject({ port: 8554 })
  })

  it('takes credentials out of the URL', () => {
    // They belong in an Authorization header; left in the request line they
    // end up in the camera's logs.
    const u = parseRtspUrl('rtsp://admin:s3cret@cam.local:8554/h264')!
    expect(u.user).toBe('admin')
    expect(u.pass).toBe('s3cret')
    expect(u.url).toBe('rtsp://cam.local:8554/h264')
    expect(u.url).not.toContain('s3cret')
  })

  it('rejects anything that is not RTSP', () => {
    expect(parseRtspUrl('http://cam/stream')).toBeNull()
    expect(parseRtspUrl('not a url')).toBeNull()
  })

  it('handles the real pipeline URL', () => {
    const u = parseRtspUrl('rtsp://10.66.0.2:8554/basesoci2c0muxi2c1imx5191a')!
    expect(u).toMatchObject({ host: '10.66.0.2', port: 8554 })
    expect(u.url).toBe('rtsp://10.66.0.2:8554/basesoci2c0muxi2c1imx5191a')
  })
})
