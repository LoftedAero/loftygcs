import { useEffect, useMemo, useRef, useState } from 'react'
import { LaButton, LaHint, LaModal } from '../../components/La'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { useProfileLabels } from '../../../stores/guide-store'
import { connectionService } from '../../../services/connection'
import ChannelMonitor from './ChannelMonitor'
import DemoTransmitter from './DemoTransmitter'
import StickDiagram from './StickDiagram'
import {
  STICK_FUNCTIONS,
  STICK_SPECS,
  buildWrites,
  claimedChannels,
  conflictingFunctions,
  detectDeflection,
  exercisedChannels,
  mappingFromDeflection,
  updateTravel,
  type Mapping,
  type StageId,
  type StickFunction,
  type Travel,
} from './radio-cal'

// The guided calibration. Mission Planner captures endpoints and leaves the
// user to work out which channel is which and what needs reversing;
// QGroundControl walks the sticks one at a time and derives both. This is the
// latter, because the mapping and the reversals are exactly the part people
// get wrong, and getting them wrong is discovered in the air.

export default function RadioCalWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const channels = useVehicleStore((s) => s.rcChannels)
  const { channelLabels } = useProfileLabels()
  const isDemo = useConnectionStore((s) => s.kind === 'virtual')

  const [stage, setStage] = useState<StageId>('intro')
  const [step, setStep] = useState(0)
  const [baseline, setBaseline] = useState<number[]>([])
  const [mapping, setMapping] = useState<Partial<Record<StickFunction, Mapping>>>({})
  const [travel, setTravel] = useState<Travel[]>([])
  const [centers, setCenters] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<{ written: number; failed: string[] } | null>(null)

  const fn = STICK_FUNCTIONS[step]
  const spec = fn ? STICK_SPECS[fn] : null

  // Live read of whichever stick this step is asking for.
  const deflection = useMemo(
    () =>
      stage === 'identify'
        ? detectDeflection(baseline, channels, claimedChannels(mapping))
        : null,
    [stage, baseline, channels, mapping],
  )

  // The sweep watches every sample rather than only the ones a render happens
  // to catch, so an endpoint touched briefly still counts.
  useEffect(() => {
    if (stage !== 'sweep' || channels.length === 0) return
    setTravel((t) => updateTravel(t, channels))
  }, [stage, channels])

  const reset = () => {
    setStage('intro')
    setStep(0)
    setBaseline([])
    setMapping({})
    setTravel([])
    setCenters([])
    setError('')
    setSaved(null)
  }

  // Reopening after a finished run should not show the previous result.
  const wasOpen = useRef(open)
  useEffect(() => {
    if (open && !wasOpen.current) reset()
    wasOpen.current = open
  }, [open])

  const acceptCenter = () => {
    if (channels.length === 0) return
    setBaseline(channels.slice())
    setStage('identify')
    setStep(0)
  }

  const acceptIdentify = () => {
    if (!fn || !deflection) return
    const next = { ...mapping, [fn]: mappingFromDeflection(deflection) }
    setMapping(next)
    if (step + 1 < STICK_FUNCTIONS.length) setStep(step + 1)
    else setStage('sweep')
  }

  const acceptSweep = () => {
    setStage('trims')
  }

  const acceptTrims = () => {
    setCenters(channels.slice())
    setStage('review')
  }

  const save = async () => {
    setSaving(true)
    setError('')
    const writes = buildWrites({ mapping, travel, centers })
    let written = 0
    const failed: string[] = []
    for (const w of writes) {
      try {
        // Written straight through rather than staged: a half-applied radio
        // calibration is worse than none, so each one is ack-verified here.
        await connectionService.setParamNow(w.param, w.value)
        written++
      } catch {
        failed.push(w.param)
      }
    }
    setSaving(false)
    setSaved({ written, failed })
  }

  const conflicts = conflictingFunctions(mapping)
  const swept = exercisedChannels(travel)
  const noInput = channels.length === 0

  return (
    <LaModal
      open={open}
      wide
      title="Radio calibration"
      actions={
        <>
          <LaButton variant="ghost" onClick={onClose} disabled={saving}>
            {saved ? 'Close' : 'Cancel'}
          </LaButton>
          {stage === 'intro' && (
            <LaButton variant="primary" disabled={noInput} onClick={() => setStage('center')}>
              Start
            </LaButton>
          )}
          {stage === 'center' && (
            <LaButton variant="primary" disabled={noInput} onClick={acceptCenter}>
              Sticks are centered
            </LaButton>
          )}
          {stage === 'identify' && (
            <LaButton variant="primary" disabled={!deflection} onClick={acceptIdentify}>
              {deflection ? `Channel ${deflection.channel} — next` : 'Waiting for the stick…'}
            </LaButton>
          )}
          {stage === 'sweep' && (
            <LaButton variant="primary" disabled={swept.length === 0} onClick={acceptSweep}>
              Done sweeping
            </LaButton>
          )}
          {stage === 'trims' && (
            <LaButton variant="primary" disabled={noInput} onClick={acceptTrims}>
              Sticks are centered
            </LaButton>
          )}
          {stage === 'review' && !saved && (
            <LaButton
              variant="primary"
              disabled={saving || conflicts.length > 0}
              onClick={() => void save()}
            >
              {saving ? 'Writing…' : 'Save calibration'}
            </LaButton>
          )}
        </>
      }
    >
      <div className="rc-wizard">
        <div className="rc-wizard__main">
          {stage === 'intro' && (
            <>
              {/* The checklist is the actionable part; what the wizard does
                  is what pressing Start finds out. */}
              <ul className="rc-wizard__checklist">
                <li>Remove the propellers, or disconnect motor power entirely.</li>
                <li>Turn the transmitter on and check the receiver is bound.</li>
                <li>Leave the vehicle disarmed.</li>
              </ul>
              {noInput && <LaHint error>No receiver input yet — turn the transmitter on.</LaHint>}
            </>
          )}

          {(stage === 'center' || stage === 'trims') && (
            <>
              <h3 className="rc-wizard__step">Center the sticks</h3>
              <p className="rc-wizard__lead">
                Let the roll, pitch and yaw sticks sit at center and hold the throttle all the way
                down.
              </p>
              <StickDiagram active={null} />
            </>
          )}

          {stage === 'identify' && spec && (
            <>
              <h3 className="rc-wizard__step">
                Move the {spec.label.toLowerCase()} stick {spec.maxDirection}
              </h3>
              {/* The monitor beside this highlights the channel that moved,
                  and the review table shows the direction it decided. */}
              <p className="rc-wizard__lead">Hold it there.</p>
              <StickDiagram active={fn ?? null} />
              <p className="rc-wizard__progress">
                Stick {step + 1} of {STICK_FUNCTIONS.length}
              </p>
            </>
          )}

          {stage === 'sweep' && (
            <>
              <h3 className="rc-wizard__step">Sweep everything to its limits</h3>
              <p className="rc-wizard__lead">
                Move every stick, switch and dial through its full range, several times.
              </p>
              <p className="rc-wizard__progress">
                {swept.length} channel{swept.length === 1 ? '' : 's'} swept so far
              </p>
            </>
          )}

          {stage === 'review' && (
            <>
              <h3 className="rc-wizard__step">{saved ? 'Saved' : 'Check this over'}</h3>
              <table className="rc-review">
                <thead>
                  <tr>
                    <th>Stick</th>
                    <th>Channel</th>
                    <th>Direction</th>
                    <th>Range</th>
                  </tr>
                </thead>
                <tbody>
                  {STICK_FUNCTIONS.map((f) => {
                    const m = mapping[f]
                    const t = m ? travel[m.channel - 1] : undefined
                    return (
                      <tr key={f} className={m && conflicts.includes(f) ? 'is-bad' : ''}>
                        <td>{STICK_SPECS[f].label}</td>
                        <td>{m ? m.channel : '—'}</td>
                        <td>{m ? (m.reversed ? 'Reversed' : 'Normal') : '—'}</td>
                        <td>{t ? `${Math.round(t.min)}–${Math.round(t.max)}` : 'not swept'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {conflicts.length > 0 && (
                <LaHint error>
                  Two sticks came out on the same channel, so one of them was not moved when it was
                  asked for. Run the calibration again.
                </LaHint>
              )}
              {/* What Save writes is the table above it, and the reboot the
                  mapping needs is said once the write has happened. */}
              {saved && (
                <LaHint error={saved.failed.length > 0}>
                  {saved.failed.length
                    ? `Wrote ${saved.written}; these were refused: ${saved.failed.join(', ')}`
                    : `Wrote ${saved.written} parameters. Reboot the vehicle for the stick mapping to take effect.`}
                </LaHint>
              )}
              {error && <LaHint error>{error}</LaHint>}
            </>
          )}
        </div>

        <div className="rc-wizard__side">
          {isDemo && <DemoTransmitter />}
          <ChannelMonitor
            channels={channels}
            travel={stage === 'sweep' || stage === 'review' ? travel : undefined}
            mapping={mapping}
            labels={channelLabels}
            highlight={deflection?.channel ?? null}
          />
        </div>
      </div>
    </LaModal>
  )
}
