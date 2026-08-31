import { useEffect, useState } from 'react'
import { BRAND } from '../../brand'
import { LaButton, LaModal } from '../components/La'

// What a preview build says on first run.
//
// This is not a disclaimer for its own sake. Loft GCS arms motors, changes
// flight modes, writes parameters and flashes firmware, and none of that has
// been validated against real hardware yet -- so someone handed a build has
// no way to know which parts are proven and which are merely written. Saying
// it once, plainly, at the point they can act on it, is the difference
// between a preview and a trap.
//
// Shown once per version: a tester who has read it should not have to read
// it again every launch, but a new build is a new set of claims.

const STORAGE_KEY = 'loftgcs.previewAcknowledged'

function acknowledgedVersion(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    // Storage blocked: showing the notice again is the safe way to fail.
    return null
  }
}

export default function PreviewNotice() {
  const [version, setVersion] = useState(__APP_VERSION__)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!BRAND.preview) return
    let live = true
    const decide = (v: string) => {
      if (!live) return
      setVersion(v)
      setOpen(acknowledgedVersion() !== v)
    }
    const bridge = window.loftgcs?.app
    if (bridge) bridge.getVersion().then(decide, () => decide(__APP_VERSION__))
    else decide(__APP_VERSION__)
    return () => {
      live = false
    }
  }, [])

  if (!BRAND.preview || !open) return null

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, version)
    } catch {
      // Not remembering is only a nuisance; it must not block the app.
    }
    setOpen(false)
  }

  return (
    <LaModal
      open
      wide
      title={`${BRAND.name} v${version} — preview build`}
      actions={
        <>
          {BRAND.feedbackEmail && (
            <LaButton
              variant="ghost"
              onClick={() => {
                const subject = `${BRAND.name} v${version} feedback`
                const body = `\n\n---\nBuild: v${version}\nPlatform: ${navigator.userAgent}\n`
                const url = `mailto:${BRAND.feedbackEmail}?subject=${encodeURIComponent(
                  subject,
                )}&body=${encodeURIComponent(body)}`
                if (window.loftgcs) window.loftgcs.app.openExternal(url)
                else window.open(url)
              }}
            >
              Send feedback
            </LaButton>
          )}
          <LaButton variant="primary" onClick={dismiss}>
            I understand
          </LaButton>
        </>
      }
    >
      <p className="preview-notice__lead">
        This is an unfinished build shared for feedback. Everything in it is worth trying, but
        nothing in it has been verified against a real aircraft.
      </p>

      <ul className="preview-notice__list">
        <li>
          <strong>Do not fly an aircraft you care about on this.</strong> Arming, mode changes
          and mission upload have been tested against ArduPilot SITL, not against hardware in
          the air.
        </li>
        <li>
          <strong>Firmware flashing has never been run on a real board.</strong> Use a board you
          are willing to recover with a bootloader, or leave that tab alone.
        </li>
        <li>
          Parameters are written to the vehicle for real, and take effect immediately. Keep a
          saved copy of any configuration you rely on.
        </li>
        <li>
          Missions, calibrations and the flight screen are the parts most worth your feedback —
          they are complete enough to judge.
        </li>
      </ul>

    </LaModal>
  )
}
