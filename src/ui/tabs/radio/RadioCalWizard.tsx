import { useEffect, useMemo, useRef, useState } from 'react'
import { LaButton, LaHint, LaModal } from '../../components/La'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useParamStore } from '../../../stores/param-store'
import { useWriteFeedbackStore } from '../../../stores/write-feedback-store'
import { connectionService } from '../../../services/connection'
import ChannelMonitor from './ChannelMonitor'
import StickDiagram from './StickDiagram'
import {
  IDENTIFY_STEPS,
  STICK_FUNCTIONS,
  STICK_SPECS,
  buildWrites,
  claimedChannels,
  conflictingFunctions,
  detectDeflection,
  exercisedChannels,
  mappingFromDeflection,
  reachedMin,
  updateTravel,
  type Mapping,
  type ParamWrite,
  type StageId,
  type StickFunction,
  type Travel,
} from './radio-cal'

// Guided radio calibration. Like QGroundControl, it walks each stick both
// ways and derives the channel mapping and reversals, rather than leaving
// those to the user as Mission Planner does.

export default function RadioCalWizard({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  /** Every parameter written; the dialog has closed itself. */
  onSaved?: () => void
}) {
  const channels = useVehicleStore((s) => s.rcChannels)

  const [stage, setStage] = useState<StageId>('intro')
  const [step, setStep] = useState(0)
  const [baseline, setBaseline] = useState<number[]>([])
  const [mapping, setMapping] = useState<Partial<Record<StickFunction, Mapping>>>({})
  const [travel, setTravel] = useState<Travel[]>([])
  const [saving, setSaving] = useState(false)
  /** Writes the vehicle refused, kept so Retry sends only those. */
  const [refused, setRefused] = useState<ParamWrite[]>([])

  const current = IDENTIFY_STEPS[step]
  const fn = current?.fn
  const spec = fn ? STICK_SPECS[fn] : null
  const isMax = current?.direction === 'max'
  const expected = fn ? mapping[fn] : undefined

  // The max step reads whichever unclaimed stick moved; the min step reads
  // only the channel its max step found.
  const deflection = useMemo(
    () =>
      stage === 'identify' ? detectDeflection(baseline, channels, claimedChannels(mapping)) : null,
    [stage, baseline, channels, mapping],
  )
  const returned =
    stage === 'identify' && !isMax && spec && expected
      ? reachedMin(spec, expected, baseline, travel, channels)
      : false
  // On a min step, another stick moving while the expected one has not means
  // the preceding max step caught the wrong stick.
  const strayChannel = stage === 'identify' && !isMax && !returned ? deflection?.channel : undefined
  const ready = stage === 'identify' && (isMax ? !!deflection : returned)

  // Every sample from the first stick onward, not just those a render
  // catches, so a briefly touched endpoint still counts.
  useEffect(() => {
    if ((stage !== 'identify' && stage !== 'sweep') || channels.length === 0) return
    setTravel((t) => updateTravel(t, channels))
  }, [stage, channels])

  const reset = () => {
    setStage('intro')
    setStep(0)
    setBaseline([])
    setMapping({})
    setTravel([])
    setRefused([])
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
    if (!fn || !ready) return
    if (isMax && deflection) setMapping({ ...mapping, [fn]: mappingFromDeflection(deflection) })
    if (step + 1 < IDENTIFY_STEPS.length) setStep(step + 1)
    else setStage('sweep')
  }

  // Back undoes one step. Returning to a max step forgets what it found, so
  // a wrongly caught stick is asked for again.
  const back = () => {
    if (step === 0) {
      setStage('center')
      return
    }
    const prev = IDENTIFY_STEPS[step - 1]
    if (prev?.direction === 'max') {
      const next = { ...mapping }
      delete next[prev.fn]
      setMapping(next)
    }
    setStep(step - 1)
  }

  /**
   * Written directly rather than staged, each write ack-verified. A refusal
   * keeps the dialog open to retry only what failed, since a half-applied
   * calibration is worse than none.
   */
  const write = async (writes: ParamWrite[]) => {
    setSaving(true)
    // RCMAP_* is read at boot, so ask for a restart only if the mapping
    // changed; endpoints and reversals apply immediately.
    const entries = useParamStore.getState().entries
    const remapped = writes.some(
      (w) => w.param.startsWith('RCMAP_') && entries.get(w.param)?.value !== w.value,
    )
    const failed: ParamWrite[] = []
    for (const w of writes) {
      try {
        await connectionService.setParamNow(w.param, w.value)
      } catch {
        failed.push(w)
      }
    }
    setSaving(false)
    setRefused(failed)
    if (failed.length) return
    onClose()
    onSaved?.()
    if (remapped) {
      useWriteFeedbackStore.getState().needReboot('The stick mapping takes effect after a restart')
    }
  }

  const conflicts = conflictingFunctions(mapping)
  // One list drives both Save and the results table.
  const writes = useMemo(
    () => (stage === 'review' ? buildWrites({ mapping, travel, centers: baseline }) : []),
    [stage, mapping, travel, baseline],
  )
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
            Cancel
          </LaButton>
          {stage === 'identify' && (
            <LaButton variant="ghost" onClick={back}>
              Back
            </LaButton>
          )}
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
            // Disabled until the stick is seen; the monitor highlights the
            // channel found.
            <LaButton variant="primary" disabled={!ready} onClick={acceptIdentify}>
              Next
            </LaButton>
          )}
          {stage === 'sweep' && (
            <LaButton variant="primary" onClick={() => setStage('review')}>
              Next
            </LaButton>
          )}
          {stage === 'review' && (
            <LaButton
              variant="primary"
              disabled={saving || conflicts.length > 0}
              onClick={() => void write(refused.length ? refused : writes)}
            >
              {saving ? 'Writing…' : refused.length ? 'Retry' : 'Save calibration'}
            </LaButton>
          )}
        </>
      }
    >
      {/* Results take the full width; the live monitor is no longer needed. */}
      <div className={`rc-wizard${stage === 'review' ? ' rc-wizard--results' : ''}`}>
        <div className="rc-wizard__main">
          {stage === 'intro' && (
            <>
              <ul className="rc-wizard__checklist">
                <li>Remove the propellers, or disconnect motor power entirely.</li>
                <li>Turn the transmitter on and check the receiver is bound.</li>
                <li>Leave the vehicle disarmed.</li>
              </ul>
              {noInput && <LaHint error>No receiver input yet — turn the transmitter on.</LaHint>}
            </>
          )}

          {stage === 'center' && (
            <>
              <h3 className="rc-wizard__step">Center the sticks</h3>
              {/* One line, like every step, so the diagram does not jump. */}
              <p className="rc-wizard__lead">Hold the throttle all the way down.</p>
              <StickDiagram active={null} />
            </>
          )}

          {stage === 'identify' && spec && (
            <>
              <h3 className="rc-wizard__step">
                Move the {spec.label.toLowerCase()} stick{' '}
                {isMax ? spec.maxDirection : spec.minDirection}
              </h3>
              {/* The throttle has no spring, so it stays up through both yaw
                  steps, avoiding the rudder-arm gesture (IDENTIFY_STEPS). A
                  stray-stick warning replaces this line rather than adding
                  one, so the diagram does not move. */}
              <p className={`rc-wizard__lead${strayChannel ? ' is-bad' : ''}`}>
                {strayChannel
                  ? `Channel ${strayChannel} moved, not ${expected?.channel}. Wrong stick? Go back.`
                  : fn === 'yaw'
                    ? 'Keep the throttle up.'
                    : fn === 'throttle'
                      ? 'Leave it there.'
                      : 'Hold it there.'}
              </p>
              <StickDiagram
                active={fn ?? null}
                direction={current?.direction ?? 'max'}
                throttle={fn === 'yaw' ? 'up' : 'down'}
              />
            </>
          )}

          {stage === 'sweep' && (
            <>
              {/* Optional, so Next is always enabled. */}
              <h3 className="rc-wizard__step">Move each switch and dial through its range</h3>
              {/* Includes the stick channels swept in the earlier steps. */}
              <p className="rc-wizard__progress">
                Channels swept: {swept.length ? swept.join(', ') : 'none'}
              </p>
            </>
          )}

          {stage === 'review' && (
            <>
              <h3 className="rc-wizard__step">Results</h3>
              <ResultsTable
                writes={writes}
                mapping={mapping}
                conflicts={conflicts}
                refused={refused}
              />
              {conflicts.length > 0 && (
                <LaHint error>
                  Two sticks came out on the same channel, so one of them was not moved when it was
                  asked for. Run the calibration again.
                </LaHint>
              )}
              {refused.length > 0 && (
                <LaHint error>The vehicle refused {refused.map((w) => w.param).join(', ')}.</LaHint>
              )}
            </>
          )}
        </div>

        {stage !== 'review' && (
          <div className="rc-wizard__side">
            <ChannelMonitor
              channels={channels}
              travel={stage === 'identify' || stage === 'sweep' ? travel : undefined}
              mapping={mapping}
              highlight={
                stage === 'identify'
                  ? ((isMax ? deflection?.channel : expected?.channel) ?? null)
                  : null
              }
            />
          </div>
        )}
      </div>
    </LaModal>
  )
}

/**
 * What Save will write, a row per channel, showing each parameter name with
 * its raw value. Drawn from the write list: a cell with no write is a dash,
 * and a refused write is marked in place.
 */
function ResultsTable({
  writes,
  mapping,
  conflicts,
  refused,
}: {
  writes: readonly ParamWrite[]
  mapping: Partial<Record<StickFunction, Mapping>>
  conflicts: readonly StickFunction[]
  refused: readonly ParamWrite[]
}) {
  const value = new Map(writes.map((w) => [w.param, w.value]))
  const bad = new Set(refused.map((w) => w.param))
  const channels = [
    ...new Set(
      writes.flatMap((w) => {
        const m = /^RC(\d+)_/.exec(w.param)
        return m ? [Number(m[1])] : []
      }),
    ),
  ].sort((a, b) => a - b)

  // Names are monospace, so padding each column to its longest name in `ch`
  // aligns the values.
  const widest = (suffix: string | RegExp) =>
    Math.max(
      0,
      ...writes
        .map((w) => w.param)
        .filter((p) => p.match(suffix))
        .map((p) => p.length),
    )
  const pair = (param: string, width: number) => {
    const v = value.get(param)
    if (v === undefined) return null
    return (
      <span key={param} className={`rc-review__pair${bad.has(param) ? ' is-bad' : ''}`}>
        <span className="la-field__param" style={{ minWidth: `${width}ch` }}>
          {param}
        </span>
        <span className="rc-review__value">{v}</span>
      </span>
    )
  }
  const cell = (params: string[], width: number) => {
    const pairs = params.map((p) => pair(p, width)).filter(Boolean)
    return <td>{pairs.length ? pairs : '—'}</td>
  }
  const w = {
    map: widest(/^RCMAP_/),
    min: widest(/_MIN$/),
    trim: widest(/_TRIM$/),
    max: widest(/_MAX$/),
    rev: widest(/_REVERSED$/),
  }

  return (
    <table className="rc-review">
      <thead>
        <tr>
          <th>Channel</th>
          <th>Stick</th>
          <th>Mapping</th>
          <th>Minimum</th>
          <th>Trim</th>
          <th>Maximum</th>
          <th>Reversed</th>
        </tr>
      </thead>
      <tbody>
        {channels.map((n) => {
          const fns = STICK_FUNCTIONS.filter((f) => mapping[f]?.channel === n)
          return (
            <tr key={n} className={fns.some((f) => conflicts.includes(f)) ? 'is-bad' : ''}>
              <td>{n}</td>
              <td>{fns.length ? fns.map((f) => STICK_SPECS[f].label).join(', ') : '—'}</td>
              {cell(
                fns.map((f) => STICK_SPECS[f].rcmapParam),
                w.map,
              )}
              {cell([`RC${n}_MIN`], w.min)}
              {cell([`RC${n}_TRIM`], w.trim)}
              {cell([`RC${n}_MAX`], w.max)}
              {cell([`RC${n}_REVERSED`], w.rev)}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
