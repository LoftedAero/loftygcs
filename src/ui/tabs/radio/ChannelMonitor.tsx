import {
  STICK_FUNCTIONS,
  STICK_SPECS,
  type Mapping,
  type StickFunction,
  type Travel,
} from './radio-cal'
import { pwmPct as pct } from '../../pwm-scale'

// Live receiver input, one bar per channel. Two things make this more useful
// than a row of numbers: the bar shows where a channel sits inside its own
// travel, and once the wizard has identified a stick, the channel carrying it
// says so -- which is the answer Mission Planner leaves you to work out.

export interface ChannelMonitorProps {
  channels: readonly number[]
  /** Recorded extremes, drawn as ticks while a sweep is in progress. */
  travel?: readonly Travel[] | undefined
  mapping?: Partial<Record<StickFunction, Mapping>> | undefined
  /** Extra name per channel from an aircraft profile. */
  labels?: Record<number, string | undefined>
  /** Channel the wizard is watching right now. */
  highlight?: number | null | undefined
  /**
   * Rows to draw whatever the receiver reports -- a channel it does not send
   * is a dash. The Radio card fixes this at sixteen, so it is one height with
   * an 8-channel receiver, a 16-channel one, or nothing switched on yet; it
   * had been a sentence until the first RC_CHANNELS, then as many bars as
   * that message counted.
   */
  slots?: number
}

export default function ChannelMonitor({
  channels,
  travel,
  mapping,
  labels,
  highlight,
  slots = 0,
}: ChannelMonitorProps) {
  const count = Math.max(slots, channels.length)

  const fnByChannel = new Map<number, StickFunction>()
  if (mapping) {
    for (const fn of STICK_FUNCTIONS) {
      const m = mapping[fn]
      if (m) fnByChannel.set(m.channel, fn)
    }
  }

  return (
    <div className="rc-monitor">
      {Array.from({ length: count }, (_, i) => {
        const v = channels[i] ?? 0
        const channel = i + 1
        const fn = fnByChannel.get(channel)
        const t = travel?.[i]
        const reversed = fn ? mapping?.[fn]?.reversed : false
        return (
          <div
            key={channel}
            className={`rc-monitor__row${highlight === channel ? ' is-watched' : ''}`}
          >
            {/* What the channel carries, right-aligned against its number,
                and the number against its bar: with the name after the
                number, a column wide enough for "Throttle reversed" left
                every unnamed channel's number that far from its bar. The
                column stays reserved, so bars do not move as the wizard
                names sticks. REV is the transmitter's own word for it. */}
            <span className="rc-monitor__label">
              {fn && <span className="rc-monitor__fn">{STICK_SPECS[fn].label}</span>}
              {reversed && (
                <span className="rc-monitor__rev" title="Reversed">
                  REV
                </span>
              )}
              {!fn && labels?.[channel] && (
                <span className="rc-monitor__profile">{labels[channel]}</span>
              )}
            </span>
            <span className="rc-monitor__num">{channel}</span>
            <div className="rc-monitor__track">
              {t && t.max - t.min > 0 && (
                <span
                  className="rc-monitor__range"
                  style={{ left: `${pct(t.min)}%`, width: `${pct(t.max) - pct(t.min)}%` }}
                />
              )}
              {v > 0 && <span className="rc-monitor__fill" style={{ width: `${pct(v)}%` }} />}
            </div>
            <span className="rc-monitor__value">{v || '—'}</span>
          </div>
        )
      })}
    </div>
  )
}
