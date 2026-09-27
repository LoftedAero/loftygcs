import {
  STICK_FUNCTIONS,
  STICK_SPECS,
  type Mapping,
  type StickFunction,
  type Travel,
} from './radio-cal'
import { pwmPct as pct } from '../../pwm-scale'

// Live receiver input, one bar per channel. Each bar shows where the channel
// sits in its own travel, and channels the wizard has identified are named.

export interface ChannelMonitorProps {
  channels: readonly number[]
  /** Recorded extremes, drawn as ticks while a sweep is in progress. */
  travel?: readonly Travel[] | undefined
  mapping?: Partial<Record<StickFunction, Mapping>> | undefined
  /** Channel the wizard is watching right now. */
  highlight?: number | null | undefined
  /**
   * Rows to draw whatever the receiver reports; a channel it does not send is
   * a dash. The Radio card fixes this at sixteen so its height is constant.
   */
  slots?: number
}

export default function ChannelMonitor({
  channels,
  travel,
  mapping,
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
            {/* The channel's function, right-aligned before its number, in a
                reserved column so bars do not move as sticks are named. REV
                is the transmitter's term. */}
            <span className="rc-monitor__label">
              {fn && <span className="rc-monitor__fn">{STICK_SPECS[fn].label}</span>}
              {reversed && (
                <span className="rc-monitor__rev" title="Reversed">
                  REV
                </span>
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
