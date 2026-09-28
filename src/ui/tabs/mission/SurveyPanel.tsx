import { useEffect, useMemo, useRef } from 'react'
import { useUnits } from '../../../stores/preferences-store'
import { distanceLabel, fromDistance, toDistance } from '../../../units'
import { LaButton, LaField, LaHint, LaInput } from '../../components/La'
import { useMissionStore } from '../../../stores/mission-store'
import { polygonAreaM2, surveyGrid } from '../../../protocol/survey'

// Drawing a survey area, and turning it into passes.
//
// The polygon is only input. Generate turns it into ordinary waypoints that
// can be edited like any others, and the polygon is discarded. (QGroundControl
// instead keeps a survey as a live object and regenerates it, which prevents
// editing individual waypoints.)
//
// A generated grid cannot be re-cut afterwards, so the area is kept while the
// panel is open to try spacing and angle against a live preview.

export default function SurveyPanel() {
  const units = useUnits()
  const survey = useMissionStore((s) => s.survey)
  const setOptions = useMissionStore((s) => s.setSurveyOptions)
  const cancel = useMissionStore((s) => s.cancelSurvey)
  const removeVertex = useMissionStore((s) => s.removeSurveyVertex)
  const addItem = useMissionStore((s) => s.addItem)
  const updateItem = useMissionStore((s) => s.updateItem)
  const frame = useMissionStore((s) => s.defaults.frame)
  const ref = useRef<HTMLElement>(null)

  // The panel opens below the fold of a tall column; scroll it into view.
  const active = survey !== null
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active])

  const result = useMemo(
    () => (survey ? surveyGrid(survey.polygon, survey.options) : null),
    [survey],
  )
  const areaM2 = useMemo(() => (survey ? polygonAreaM2(survey.polygon) : 0), [survey])

  if (!survey) return null

  const generate = () => {
    if (!result || result.points.length === 0) return
    for (const p of result.points) {
      const uid = addItem(16, { x: p.x, y: p.y })
      updateItem(uid, { z: survey.altM, frame })
    }
    cancel()
  }

  return (
    <section className="app-col__group survey-panel" ref={ref}>
      <div className="app-col__headrow">
        <h3 className="app-col__head">Survey area</h3>
        <span className="mission-badge">{survey.polygon.length} corners</span>
      </div>

      {survey.polygon.length < 3 ? (
        <LaHint>Click the map to drop at least three corners.</LaHint>
      ) : (
        <p className="app-col__note">
          {formatArea(areaM2)}
          {result?.passes
            ? ` · ${result.passes} ${result.passes === 1 ? 'pass' : 'passes'} · ${formatLength(result.lengthM)}`
            : ''}
        </p>
      )}

      <LaField
        label="Line spacing"
        unit={distanceLabel(units.distance)}
        htmlFor="survey-spacing"
        stacked
      >
        <LaInput
          num
          id="survey-spacing"
          type="number"
          min={1}
          value={Math.round(toDistance(survey.options.spacingM, units.distance))}
          onChange={(e) =>
            setOptions({ spacingM: fromDistance(Number(e.target.value), units.distance) })
          }
        />
      </LaField>
      <LaField label="Angle" unit="° from north" htmlFor="survey-angle" stacked>
        <LaInput
          num
          id="survey-angle"
          type="number"
          value={survey.options.angleDeg}
          onChange={(e) => setOptions({ angleDeg: Number(e.target.value) })}
        />
      </LaField>
      <LaField
        label="Overshoot"
        unit={distanceLabel(units.distance)}
        htmlFor="survey-overshoot"
        stacked
      >
        <LaInput
          num
          id="survey-overshoot"
          type="number"
          min={0}
          value={Math.round(toDistance(survey.options.overshootM, units.distance))}
          onChange={(e) =>
            setOptions({ overshootM: fromDistance(Number(e.target.value), units.distance) })
          }
        />
      </LaField>
      <LaField label="Altitude" unit={distanceLabel(units.distance)} htmlFor="survey-alt" stacked>
        <LaInput
          num
          id="survey-alt"
          type="number"
          min={0}
          value={Math.round(toDistance(survey.altM, units.distance))}
          onChange={(e) =>
            setOptions({ altM: fromDistance(Number(e.target.value), units.distance) })
          }
        />
      </LaField>

      {result?.problem && survey.polygon.length >= 3 && <LaHint error>{result.problem}</LaHint>}

      <LaButton
        variant="primary"
        size="block"
        disabled={!result || result.points.length === 0}
        onClick={generate}
      >
        Add {result?.points.length ?? 0} waypoints
      </LaButton>
      <LaButton
        variant="secondary"
        size="block"
        disabled={survey.polygon.length === 0}
        onClick={() => removeVertex(survey.polygon.length - 1)}
      >
        Undo corner
      </LaButton>
      <LaButton variant="ghost" size="block" onClick={cancel}>
        Cancel survey
      </LaButton>
      <LaHint>The area is not kept after generating.</LaHint>
    </section>
  )
}

function formatArea(m2: number): string {
  if (m2 >= 1e6) return `${(m2 / 1e6).toFixed(2)} km²`
  if (m2 >= 10000) return `${(m2 / 10000).toFixed(2)} ha`
  return `${Math.round(m2)} m²`
}

function formatLength(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`
}
