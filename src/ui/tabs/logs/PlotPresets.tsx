import { useState } from 'react'
import { LaButton, LaHint, LaInput } from '../../components/La'
import { useLogStore } from '../../../stores/log-store'

// Saved plot setups.
//
// Anyone reviewing logs has a handful of standing questions -- "is the yaw
// tracking", "what did the motors do" -- and each is the same six fields on
// the same axes in the same colors every time. Rebuilding that by hand at
// the top of every log is the tedious part of log review, so a setup is
// named once and recalled thereafter.
//
// Kept in the browser rather than beside the log: a preset belongs to the
// person asking the question, not to the flight being asked about. It
// carries expressions too, which is what makes it worth saving at all --
// nobody wants to retype sqrt(IMU.AccX^2 + IMU.AccY^2).

export default function PlotPresets() {
  const presets = useLogStore((s) => s.presets)
  const selected = useLogStore((s) => s.selected)
  const savePreset = useLogStore((s) => s.savePreset)
  const loadPreset = useLogStore((s) => s.loadPreset)
  const deletePreset = useLogStore((s) => s.deletePreset)
  const [name, setName] = useState('')

  const names = Object.keys(presets).sort((a, b) => a.localeCompare(b))
  const trimmed = name.trim()
  const overwrites = trimmed in presets

  return (
    <section className="app-col__group">
      <h3 className="app-col__head">Presets</h3>

      {names.length === 0 ? (
        <LaHint>None saved. Set the plot up, name it, and it comes back next time.</LaHint>
      ) : (
        names.map((n) => (
          <div key={n} className="preset">
            <button
              type="button"
              className="preset__load"
              title={presets[n]!.map((f) => f.expression ?? `${f.message}.${f.field}`).join(', ')}
              onClick={() => loadPreset(n)}
            >
              <span className="preset__name">{n}</span>
              <span className="log-picker__count">{presets[n]!.length}</span>
            </button>
            <button
              type="button"
              className="fence-item__x"
              aria-label={`Delete preset ${n}`}
              onClick={() => deletePreset(n)}
            >
              ✕
            </button>
          </div>
        ))
      )}

      <LaInput
        value={name}
        placeholder="Name this setup"
        aria-label="Preset name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && trimmed && selected.length > 0) {
            savePreset(trimmed)
            setName('')
          }
        }}
      />
      <LaButton
        variant="secondary"
        size="block"
        disabled={!trimmed || selected.length === 0}
        title={
          selected.length === 0
            ? 'Plot something first'
            : `Save ${selected.length} traces as ${trimmed || '…'}`
        }
        onClick={() => {
          savePreset(trimmed)
          setName('')
        }}
      >
        {overwrites ? `Replace “${trimmed}”` : 'Save preset'}
      </LaButton>
    </section>
  )
}
