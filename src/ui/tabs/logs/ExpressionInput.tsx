import { useState } from 'react'
import { LaButton, LaHint, LaInput } from '../../components/La'
import { expressionError } from '../../../protocol/log-expression'
import { useLogStore } from '../../../stores/log-store'

// Plotting something the log does not record.
//
// It sits under the field list because it answers the same question the
// list does -- "what goes on the plot" -- and because the names it needs
// are the ones directly above it: you find ATT.DesRoll by searching, then
// type it into an expression.
//
// The error appears while typing rather than on submit. Half of these are
// mistyped field names, and a log has six hundred of them; being told at
// the moment of the typo beats being told after pressing a button.

/** Worked examples, chosen to teach the three things the syntax can do. */
const EXAMPLES = [
  { text: 'ATT.DesRoll - ATT.Roll', why: 'roll tracking error' },
  { text: 'sqrt(IMU.AccX^2 + IMU.AccY^2)', why: 'lateral acceleration' },
  { text: 'BARO.Alt * 3.28084', why: 'altitude in feet' },
]

export default function ExpressionInput() {
  const log = useLogStore((s) => s.log)
  const addExpression = useLogStore((s) => s.addExpression)
  const [text, setText] = useState('')
  const [rejected, setRejected] = useState<string | null>(null)

  if (!log) return null

  // Nothing typed is not an error, it is the resting state.
  const live = text.trim() ? expressionError(log, text) : null
  const problem = rejected ?? live

  const submit = () => {
    const failed = addExpression(text)
    setRejected(failed)
    if (!failed) setText('')
  }

  return (
    <div className="log-expr">
      <h3 className="app-col__head">Expression</h3>
      <LaInput
        value={text}
        placeholder="ATT.DesRoll - ATT.Roll"
        aria-label="Expression to plot"
        aria-invalid={problem ? true : undefined}
        onChange={(e) => {
          setText(e.target.value)
          setRejected(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
      />
      {problem ? (
        <LaHint error>{problem}</LaHint>
      ) : (
        <div className="log-expr__examples">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.text}
              type="button"
              className="log-expr__example"
              title={`Try: ${ex.why}`}
              onClick={() => {
                setText(ex.text)
                setRejected(null)
              }}
            >
              {ex.text}
            </button>
          ))}
        </div>
      )}
      <LaButton variant="secondary" size="block" disabled={!text.trim() || !!live} onClick={submit}>
        Plot expression
      </LaButton>
    </div>
  )
}
