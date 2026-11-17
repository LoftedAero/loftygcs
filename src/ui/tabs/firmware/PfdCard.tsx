import { useEffect, useState } from 'react'
import { LaButton, LaCard, LaHint, LaModal } from '../../components/La'
import { folderPicker, PICKER_ID, rememberCard, rememberedCard } from '../../../services/radio-maps'
import {
  downloadRelease,
  insideLayout,
  installOnCard,
  latestRelease,
  radioLabel,
  whichRadio,
  type InstallProgress,
  type PfdRadio,
  type PfdRelease,
} from '../../../services/pfd-install'

// Installs or updates Lofty PFD on a radio's card from its latest release
// (services/pfd-install.ts). It sits with the flight controller's firmware
// because it is the radio's software, and like the firmware it needs no
// vehicle. The card picker, the remembered card and the dialog follow Copy to
// Lofty PFD in Offline maps.

/** Holds an empty slot's line open, so the dialog never changes height. */
const BLANK = ' '

// One check per session: GitHub limits unauthenticated calls per address, and
// the screen remounts on every visit. A failure is forgotten so a press retries.
let releaseCheck: Promise<PfdRelease> | null = null
function checkRelease(): Promise<PfdRelease> {
  releaseCheck ??= latestRelease().catch((e: unknown) => {
    releaseCheck = null
    throw e
  })
  return releaseCheck
}

const percent = (p: InstallProgress) => Math.floor((100 * p.done) / Math.max(1, p.total))

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')

type Status = { text: string; tone?: 'bad' }

type Ask =
  | { step: 'card'; hint?: string }
  | { step: 'radio'; card: FileSystemDirectoryHandle; update: boolean }

export default function PfdCard() {
  const picker = folderPicker()
  const [release, setRelease] = useState<PfdRelease | null>(null)
  const [status, setStatus] = useState<Status>({ text: '' })
  const [progress, setProgress] = useState<InstallProgress | null>(null)
  const [checking, setChecking] = useState(false)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [card, setCard] = useState<FileSystemDirectoryHandle | null>(null)

  useEffect(() => {
    if (!picker) return
    let live = true
    void checkRelease().then(
      (r) => live && setRelease(r),
      (e: unknown) => live && setStatus({ text: message(e), tone: 'bad' }),
    )
    void rememberedCard().then((c) => live && setCard(c))
    return () => {
      live = false
    }
    // The picker is a fixed property of the build.
  }, [])

  if (!picker) return null
  const running = progress !== null || checking

  // The release is known before the dialog opens, so its button's press is
  // still a gesture when it opens the picker.
  const begin = async () => {
    if (release) {
      setAsk({ step: 'card' })
      return
    }
    setChecking(true)
    setStatus({ text: 'Checking for the latest release…' })
    try {
      setRelease(await checkRelease())
      setStatus({ text: '' })
      setAsk({ step: 'card' })
    } catch (e) {
      setStatus({ text: message(e), tone: 'bad' })
    } finally {
      setChecking(false)
    }
  }

  const choose = async () => {
    if (!release) return
    let picked: FileSystemDirectoryHandle
    try {
      picked = await picker({ mode: 'readwrite', id: PICKER_ID, ...(card && { startIn: card }) })
    } catch {
      // Canceled, or the write grant was refused, which reads the same.
      return
    }
    const inside = insideLayout(picked, release)
    if (inside) {
      setAsk({ step: 'card', hint: `Select the root directory, not ${inside}.` })
      return
    }
    setCard(picked)
    void rememberCard(picked)
    const found = await whichRadio(picked, release)
    if (!found) {
      setAsk({ step: 'radio', card: picked, update: false })
      return
    }
    setAsk(null)
    void install(picked, found.radio, found.update)
  }

  const install = async (target: FileSystemDirectoryHandle, radio: PfdRadio, update: boolean) => {
    if (!release) return
    setStatus({ text: '' })
    setProgress({ phase: 'download', done: 0, total: 1 })
    let data: Map<string, ArrayBuffer>
    try {
      data = await downloadRelease(release, radio, setProgress)
    } catch (e) {
      setProgress(null)
      setStatus({ text: `${message(e)} The card was not changed.`, tone: 'bad' })
      return
    }
    try {
      await installOnCard(target, radio, data, setProgress)
      const label = radioLabel(radio.key)
      setStatus({
        text: update
          ? `Updated to ${release.version} on the ${label} radio.`
          : `Installed ${release.version} on the ${label} radio.`,
      })
    } catch {
      setStatus({ text: 'The card could not be written.', tone: 'bad' })
    } finally {
      setProgress(null)
    }
  }

  const radios = release
    ? [...release.radios].sort((a, b) => radioLabel(a.key).localeCompare(radioLabel(b.key)))
    : []

  return (
    <LaCard className="fw-card" title="Lofty PFD">
      <div className="fw-step">
        <span className="fw-step__label">Release</span>
        <div className="fw-step__body">
          <div className="la-readout" data-placeholder="—">
            {release ? `${release.version} · latest` : ''}
          </div>
          <LaButton variant="primary" disabled={running} onClick={() => void begin()}>
            Install on radio
          </LaButton>
        </div>
      </div>

      {/* One fixed slot, as on the firmware card: progress while running,
          otherwise the last outcome. */}
      <div className="fw-state">
        {progress ? (
          <>
            <span className="fw-state__text">
              {progress.phase === 'download'
                ? `Downloading ${release?.version ?? ''}…`
                : 'Writing to the card…'}
            </span>
            <div className="cal-progress" role="progressbar" aria-valuenow={percent(progress)}>
              <div className="cal-progress__fill" style={{ width: `${percent(progress)}%` }} />
            </div>
          </>
        ) : (
          <span className={`fw-state__text${status.tone ? ' fw-state__text--bad' : ''}`}>
            {status.text}
          </span>
        )}
      </div>

      {ask?.step === 'card' && release && (
        <LaModal
          open
          title={`Install Lofty PFD ${release.version}`}
          actions={
            <>
              <LaButton variant="ghost" onClick={() => setAsk(null)}>
                Cancel
              </LaButton>
              <LaButton variant="primary" onClick={() => void choose()}>
                Choose SD card
              </LaButton>
            </>
          }
        >
          <p>Select the root directory of your radio's SD card or internal memory.</p>
          <p>Lofty PFD will be installed at:</p>
          <dl className="pfd-folders">
            {radios.map((r) => (
              <div key={r.key} className="pfd-folders__row">
                <dt>{radioLabel(r.key)}</dt>
                <dd>{r.folder}</dd>
              </div>
            ))}
          </dl>
          <LaHint error>{ask.hint ?? BLANK}</LaHint>
        </LaModal>
      )}

      {ask?.step === 'radio' && (
        <LaModal
          open
          narrow
          title="Which radio is this card from?"
          actions={
            <>
              <LaButton variant="ghost" onClick={() => setAsk(null)}>
                Cancel
              </LaButton>
              {radios.map((r) => (
                <LaButton
                  key={r.key}
                  variant="secondary"
                  onClick={() => {
                    setAsk(null)
                    void install(ask.card, r, ask.update)
                  }}
                >
                  {radioLabel(r.key)}
                </LaButton>
              ))}
            </>
          }
        />
      )}
    </LaCard>
  )
}
