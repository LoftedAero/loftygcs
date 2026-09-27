import { useState } from 'react'
import { LaButton, LaHint, LaInput } from '../../components/La'
import { useLogStore } from '../../../stores/log-store'

// Saved plot setups: named sets of fields and expressions, recalled on any
// log. Stored in the browser, since a preset belongs to the user rather
// than to a log.

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
