import { useEffect, useState } from 'react'
import { LaButton, LaCard, LaHint } from '../components/La'
import { findGuide } from '../../profiles'
import type { GuideCheck, GuideStep } from '../../profiles/types'
import { useGuideStore } from '../../stores/guide-store'
import { useVehicleStore } from '../../stores/vehicle-store'
import { useParamStore } from '../../stores/param-store'
import { magCalFinished, magCalList, useCalStore } from '../../stores/cal-store'
import { useConnectionStore } from '../../stores/connection-store'
import { connectionService } from '../../services/connection'
import { MAV_RESULT } from '../../protocol/commands'
import AccelCalWizard from '../tabs/sensors/AccelCalWizard'
import CompassCalCard from '../tabs/sensors/CompassCalCard'

// The guide engine's renderer: a progress rail on the left, the active
// step's panel on the right. Steps mark themselves done through the store;
// Continue is the single primary action and stays gated until they do.
export default function GuideRunner() {
  const active = useGuideStore((s) => s.activeGuide)
  const stepIndex = useGuideStore((s) => s.stepIndex)
  const stepStatus = useGuideStore((s) => s.stepStatus)
  const { exitGuide, gotoStep, markStep } = useGuideStore.getState()

  const found = active ? findGuide(active.profileId, active.guideId) : null
  if (!active || !found) return null
  const { profile, guide } = found
  const step = guide.steps[stepIndex]
  if (!step) return null

  const status = stepStatus[stepIndex]
  const isLast = stepIndex === guide.steps.length - 1
  // Safety attestations are the point of a manual step; nothing else about
  // a guide is mandatory -- the user knows their bench better than we do.
  const skippable = step.kind !== 'manual' && step.kind !== 'info'

  return (
    <LaCard title={guide.title} subtitle={profile.name} className="guide-card">
      <div className="guide-layout">
        <ol className="guide-rail">
          {guide.steps.map((s, i) => (
            <li key={i}>
              <button
                className={[
                  'guide-rail__item',
                  i === stepIndex ? 'guide-rail__item--active' : '',
                  stepStatus[i] === 'done' ? 'guide-rail__item--done' : '',
                  stepStatus[i] === 'skipped' ? 'guide-rail__item--skipped' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => gotoStep(i)}
              >
                <span className="guide-rail__num">
                  {stepStatus[i] === 'done' ? '✓' : stepStatus[i] === 'skipped' ? '–' : i + 1}
                </span>
                {s.title}
              </button>
            </li>
          ))}
        </ol>
        <div className="guide-step">
          <h3 className="guide-step__title">{step.title}</h3>
          <StepView key={`${active.guideId}-${stepIndex}`} step={step} index={stepIndex} />
          <div className="la-row guide-step__actions">
            <LaButton variant="ghost" onClick={exitGuide}>
              Exit guide
            </LaButton>
            <span className="la-grow"></span>
            <LaButton
              variant="ghost"
              disabled={stepIndex === 0}
              onClick={() => gotoStep(stepIndex - 1)}
            >
              Back
            </LaButton>
            {skippable && !status && (
              <LaButton variant="ghost" onClick={() => markStep(stepIndex, 'skipped')}>
                Skip
              </LaButton>
            )}
            <LaButton
              variant="primary"
              disabled={!status}
              onClick={() => (isLast ? exitGuide() : gotoStep(stepIndex + 1))}
            >
              {isLast ? 'Finish' : 'Continue'}
            </LaButton>
          </div>
        </div>
      </div>
    </LaCard>
  )
}

function StepView({ step, index }: { step: GuideStep; index: number }) {
  switch (step.kind) {
    case 'info':
      return <InfoStep step={step} index={index} />
    case 'manual':
      return <ManualStep step={step} index={index} />
    case 'paramSet':
      return <ParamSetStep step={step} index={index} />
    case 'command':
      return <CommandStep step={step} index={index} />
    case 'calibration':
      return <CalibrationStep step={step} index={index} />
    case 'check':
      return <CheckStep step={step} index={index} />
  }
}

function useMarkDone(index: number) {
  return () => useGuideStore.getState().markStep(index, 'done')
}

function InfoStep({ step, index }: { step: Extract<GuideStep, { kind: 'info' }>; index: number }) {
  const markDone = useMarkDone(index)
  useEffect(() => {
    markDone()
    // markDone is stable (module store access); run once per step mount.
  }, [])
  return <p className="guide-step__body">{step.body}</p>
}

function ManualStep({
  step,
  index,
}: {
  step: Extract<GuideStep, { kind: 'manual' }>
  index: number
}) {
  const done = useGuideStore((s) => s.stepStatus[index] === 'done')
  const markDone = useMarkDone(index)
  return (
    <>
      <p className="guide-step__body">{step.body}</p>
      <LaButton variant="secondary" disabled={done} onClick={markDone}>
        {done ? 'Confirmed' : step.confirmLabel}
      </LaButton>
    </>
  )
}

function ParamSetStep({
  step,
  index,
}: {
  step: Extract<GuideStep, { kind: 'paramSet' }>
  index: number
}) {
  const entries = useParamStore((s) => s.entries)
  const ready = useParamStore((s) => s.loadState === 'ready')
  const markDone = useMarkDone(index)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  const apply = async () => {
    setBusy(true)
    setError('')
    const out: Record<string, string> = {}
    let allOk = true
    for (const p of step.params) {
      if (!entries.has(p.name)) {
        out[p.name] = 'not on this vehicle'
        allOk = false
        continue
      }
      try {
        const echoed = await connectionService.setParamNow(p.name, p.value)
        out[p.name] = `= ${echoed}`
      } catch {
        out[p.name] = 'write failed'
        allOk = false
      }
      setResults({ ...out })
    }
    setResults(out)
    setBusy(false)
    if (allOk) markDone()
    else setError('Some parameters did not apply — fix or Skip.')
  }

  return (
    <>
      {step.body && <p className="guide-step__body">{step.body}</p>}
      <div className="guide-paramset">
        {step.params.map((p) => {
          const current = entries.get(p.name)
          return (
            <div className="guide-paramset__row" key={p.name}>
              <span className="guide-paramset__name">{p.name}</span>
              <span className="la-muted">{current ? current.value : '—'}</span>
              <span className="guide-paramset__arrow">→</span>
              <span>{p.value}</span>
              <span className="la-muted">{results[p.name] ?? ''}</span>
            </div>
          )
        })}
      </div>
      <LaButton variant="secondary" disabled={!ready || busy} onClick={() => void apply()}>
        {busy ? 'Writing…' : 'Apply and verify'}
      </LaButton>
      {!ready && <LaHint>Connect a vehicle (parameters not loaded).</LaHint>}
      <LaHint error>{error}</LaHint>
    </>
  )
}

function CommandStep({
  step,
  index,
}: {
  step: Extract<GuideStep, { kind: 'command' }>
  index: number
}) {
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const markDone = useMarkDone(index)
  const [state, setState] = useState('')
  const run = async () => {
    setState('…')
    try {
      const result = await connectionService.runCommand(
        step.command,
        step.params ?? [],
        step.timeoutMs,
      )
      if (result === 0) {
        setState('Accepted.')
        markDone()
      } else {
        setState(`Vehicle said: ${MAV_RESULT[result] ?? result}`)
      }
    } catch (err) {
      setState(err instanceof Error ? err.message : 'no answer')
    }
  }
  return (
    <>
      {step.body && <p className="guide-step__body">{step.body}</p>}
      <LaButton variant="secondary" disabled={!connected} onClick={() => void run()}>
        {step.actionLabel}
      </LaButton>
      <LaHint>{state}</LaHint>
    </>
  )
}

function CalibrationStep({
  step,
  index,
}: {
  step: Extract<GuideStep, { kind: 'calibration' }>
  index: number
}) {
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const markDone = useMarkDone(index)
  const [accelOpen, setAccelOpen] = useState(false)
  const [state, setState] = useState('')
  // A guide step completes when the run finishes and at least one compass
  // succeeded -- the run is per-compass now, so there is no single report.
  const magCal = useCalStore((s) => s.magCal)
  const magReport = magCalFinished(magCal)
    ? (magCalList(magCal).find(([, c]) => c.report?.calStatus === 4)?.[1].report ?? null)
    : null

  // Compass: the embedded card drives the calibration; success in the cal
  // store is what completes the step.
  useEffect(() => {
    if (step.cal === 'compass' && magReport?.calStatus === 4) markDone()
    // markDone is stable; only the report matters here.
  }, [magReport])

  const runLevel = async () => {
    setState('Hold the vehicle still and level…')
    try {
      const result = await connectionService.runCommand(241, [0, 0, 0, 0, 2, 0, 0], 10000)
      if (result === 0) {
        setState('Level set.')
        markDone()
      } else setState(`Vehicle said: ${MAV_RESULT[result] ?? result}`)
    } catch (err) {
      setState(err instanceof Error ? err.message : 'failed')
    }
  }

  return (
    <>
      {step.body && <p className="guide-step__body">{step.body}</p>}
      {step.cal === 'accel' && (
        <>
          <LaButton variant="secondary" disabled={!connected} onClick={() => setAccelOpen(true)}>
            Calibrate accelerometer
          </LaButton>
          {accelOpen && (
            <AccelCalWizard onClose={() => setAccelOpen(false)} onSuccess={() => markDone()} />
          )}
        </>
      )}
      {step.cal === 'compass' && <CompassCalCard />}
      {step.cal === 'level' && (
        <LaButton variant="secondary" disabled={!connected} onClick={() => void runLevel()}>
          Set level horizon
        </LaButton>
      )}
      <LaHint>{state}</LaHint>
    </>
  )
}

function evaluateCheck(
  check: GuideCheck,
  vehicle: ReturnType<typeof useVehicleStore.getState>,
  params: ReturnType<typeof useParamStore.getState>,
): boolean {
  switch (check.type) {
    case 'gpsFix3d':
      return vehicle.gpsFix >= 3
    case 'rcSeen':
      return vehicle.rcChannels.some((v) => v > 0)
    case 'disarmed':
      return vehicle.present && !vehicle.armed
    case 'param': {
      const entry = params.entries.get(check.param)
      if (!entry) return false
      return Math.abs(entry.value - check.value) <= (check.tolerance ?? 1e-4)
    }
  }
}

function CheckStep({
  step,
  index,
}: {
  step: Extract<GuideStep, { kind: 'check' }>
  index: number
}) {
  const vehicle = useVehicleStore()
  const params = useParamStore()
  const markDone = useMarkDone(index)
  const states = step.checks.map((c) => evaluateCheck(c, vehicle, params))
  const allPass = states.every(Boolean)

  useEffect(() => {
    if (allPass) markDone()
    // markDone is stable; only the pass state matters.
  }, [allPass])
  return (
    <>
      {step.body && <p className="guide-step__body">{step.body}</p>}
      <div className="la-row la-row--wrap">
        {step.checks.map((c, i) => (
          <span
            key={i}
            className={states[i] ? 'la-led la-led--ok' : 'la-led la-led--idle'}
            title={`${c.label}: ${states[i] ? 'passing' : 'waiting'}`}
          >
            <span className="la-led__dot">{states[i] ? '✓' : '…'}</span>
            <span className="la-led__label">{c.label}</span>
          </span>
        ))}
      </div>
      {!allPass && <LaHint>Waiting for all checks to pass — they update live.</LaHint>}
    </>
  )
}
