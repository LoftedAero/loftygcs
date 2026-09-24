import { STICK_FUNCTIONS, STICK_SPECS, type Mapping, type StickFunction, type Travel } from './radio-cal'
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
}

export default function ChannelMonitor({
  channels,
  travel,
  mapping,
  labels,
  highlight,
}: ChannelMonitorProps) {
  if (channels.length === 0) {
    return <p className="app-placeholder">No receiver input yet — turn the transmitter on.</p>
  }

  const fnByChannel = new Map<number, StickFunction>()
  if (mapping) {
    for (const fn of STICK_FUNCTIONS) {
      const m = mapping[fn]
      if (m) fnByChannel.set(m.channel, fn)
    }
  }

  return (
    <div className="rc-monitor">
      {channels.map((v, i) => {
        const channel = i + 1
        const fn = fnByChannel.get(channel)
        const t = travel?.[i]
        const reversed = fn ? mapping?.[fn]?.reversed : false
        return (
          <div
            key={channel}
            className={`rc-monitor__row${highlight === channel ? ' is-watched' : ''}`}
          >
            <span className="rc-monitor__name">
              {channel}
              {fn && <span className="rc-monitor__fn">{STICK_SPECS[fn].label}</span>}
              {reversed && (
                <span className="rc-monitor__rev">reversed</span>
              )}
              {!fn && labels?.[channel] && (
                <span className="rc-monitor__profile">{labels[channel]}</span>
              )}
            </span>
            <div className="rc-monitor__track">
              {t && t.max - t.min > 0 && (
                <span
                  className="rc-monitor__range"
                  style={{ left: `${pct(t.min)}%`, width: `${pct(t.max) - pct(t.min)}%` }}
                />
              )}
              <span className="rc-monitor__fill" style={{ width: `${pct(v)}%` }} />
            </div>
            <span className="rc-monitor__value">{v || '—'}</span>
          </div>
        )
      })}
    </div>
  )
}
