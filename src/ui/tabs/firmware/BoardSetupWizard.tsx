import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { mdiEye, mdiEyeOff, mdiUsb } from '@mdi/js'
import { LaButton, LaModal, LaSelect } from '../../components/La'
import type { BoardEntry, FirmwareOption } from '../../../protocol/lofted-boards'
import { PASS_TIMEOUT_S, type PassthroughStep } from '../../../protocol/elrs/usb-passthrough'
import type { ElrsTargetConfig } from '../../../protocol/elrs/firmware'
import {
  chooseDfuDevice,
  connectArduPilot,
  grantedArduPilotPort,
  firmwarePort,
  installBlank,
  nextArduPilotPort,
  watchForDfu,
} from '../../../services/board-setup'
import {
  elrsTarget,
  elrsVersions,
  receiverImages,
  type ElrsRegion,
  type ElrsVersion,
} from '../../../services/elrs-firmware'
import { flashReceiver, restoreReceiverSettings } from '../../../services/receiver-flash'
import { PortCancelledError } from '../../../transport/web-serial'
import { useBoardSetupStore } from '../../../stores/board-setup-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { useFlashStore } from '../../../stores/flash-store'
import { usePreferencesStore } from '../../../stores/preferences-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { isElectron } from '../../../env'
import { playTone } from '../../../services/voice/tones'
import { boardGuide, type BoardPicture, type Mark } from './board-pictures'
import { productLabel } from './lofted-products'

// The first flash of a Lofted Aero board, to one that flies: the firmware
// with its bootloader over ROM DFU, then the onboard receiver. The first step
// holds everything the pilot has to do or answer, with a picture; the rest
// runs by itself and narrates itself on the state line, as the Firmware card
// does. An update needs none of this and runs from the card.

type Stage = 'prepare' | 'firmware' | 'receiver' | 'check'

const STAGE_LABEL: Record<Stage, string> = {
  prepare: 'Prepare',
  firmware: 'Firmware',
  receiver: 'Receiver',
  check: 'Check',
}

/** What a running flash is doing, for a state line. */
export const FLASH_LABEL: Record<string, string> = {
  sync: 'Contacting the bootloader…',
  erase: 'Erasing…',
  program: 'Writing…',
  verify: 'Verifying…',
  reboot: 'Rebooting the board…',
  leave: 'Leaving DFU mode…',
}

const RECEIVER_LABEL: Record<PassthroughStep, string> = {
  configure: 'Configuring the flight controller…',
  reboot: 'Rebooting the flight controller…',
  'download-mode': 'Starting the receiver’s bootloader…',
  passthrough: 'Opening the passthrough…',
  esptool: 'Writing the receiver…',
  'wait-exit': 'Waiting for the flight controller…',
  'boot-receiver': 'Starting the receiver…',
  restore: 'Restoring the flight controller settings…',
  verify: 'Checking the settings…',
}

/** How long the board has to appear in DFU before the hints show. */
const DFU_HINT_MS = 30000

/** How long a replugged board has to come back before Connect is offered. */
const REPLUG_CONNECT_MS = 15000

type Status = { text: string; tone?: 'warn' | 'bad' }

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

const onWindows = () => typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent)

export default function BoardSetupWizard({
  entry,
  releaseIndex,
  option,
  dfu: foundDfu,
  onClose,
}: {
  entry: BoardEntry
  releaseIndex: number
  option: FirmwareOption
  /** The board, when the card's press already found it in DFU; null shows the guide to DFU. */
  dfu: USBDevice | null
  /** With the confirmation to leave on the card, or null when canceled. */
  onClose: (done: string | null) => void
}) {
  const { release, board } = entry.releases[releaseIndex]!
  const guide = boardGuide(board.id)
  const stages = useMemo<Stage[]>(
    () => ['prepare', 'firmware', ...(board.receiver ? (['receiver'] as const) : []), 'check'],
    [board.receiver],
  )

  const [stage, setStage] = useState<Stage>('prepare')
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState<Status>({
    text: foundDfu ? 'Found the board in DFU mode.' : '',
  })
  const [progress, setProgress] = useState<number | null>(null)
  /** The last stage's work failed; its button retries exactly that. */
  const [failed, setFailed] = useState(false)
  const [dfu, setDfu] = useState<USBDevice | null>(foundDfu)
  /**
   * The board was already in DFU when the wizard opened, so the guide to DFU
   * is left out. Fixed at opening, so a board that arrives later moves nothing.
   */
  const [foundInDfu] = useState(foundDfu !== null)
  /** The image is on the board, so a retry only has to reach ArduPilot. */
  const flashed = useRef(false)
  /** A browser needs a press to show its chooser for ArduPilot's port. */
  const [needPort, setNeedPort] = useState(false)
  /** The receiver write left the flight controller deaf; waiting for a replug. */
  const [replug, setReplug] = useState(false)
  /**
   * The replugged board has not come back by itself. Only then is Connect
   * offered: the desktop app finds the board without it, and a browser only
   * needs it for a port it was never granted.
   */
  const [replugLate, setReplugLate] = useState(false)
  useEffect(() => {
    setReplugLate(false)
    if (!replug) return
    const late = setTimeout(() => setReplugLate(true), REPLUG_CONNECT_MS)
    return () => clearTimeout(late)
  }, [replug])

  const flashPhase = useFlashStore((s) => s.phase)
  const flashProgress = useFlashStore((s) => s.progress)

  // While the wizard is open, its reconnections are its own business.
  useEffect(() => {
    useBoardSetupStore.getState().setBusy(true)
    return () => {
      useBoardSetupStore.getState().setBusy(false)
      // The Firmware card shares the flash store; leave it idle.
      useFlashStore.getState().setPhase('idle')
    }
  }, [])

  const fail = (e: unknown) => {
    setRunning(false)
    setProgress(null)
    setFailed(true)
    if (e instanceof PortCancelledError) setStatus({ text: '' })
    else setStatus({ text: message(e), tone: 'bad' })
  }

  const advance = (from: Stage) => {
    const next = stages[stages.indexOf(from) + 1]
    setFailed(false)
    setProgress(null)
    setStatus({ text: '' })
    if (next) setStage(next)
  }

  // ---- prepare: find the board in ROM DFU ---------------------------------
  useEffect(() => {
    if (stage !== 'prepare' || dfu) return
    setStatus({ text: 'Waiting for the board in DFU mode…' })
    const stop = watchForDfu((d) => {
      setDfu(d)
      setStatus({ text: 'Found the board in DFU mode.' })
    })
    const hint = setTimeout(() => {
      setStatus({
        text: onWindows()
          ? 'No board detected in DFU mode. Unplug the GPS, then reconnect USB with the button held. Windows also needs the WinUSB driver for STM32 BOOTLOADER.'
          : 'No board detected in DFU mode. Unplug the GPS, then reconnect USB with the button held.',
        tone: 'warn',
      })
    }, DFU_HINT_MS)
    return () => {
      stop()
      clearTimeout(hint)
    }
  }, [stage, dfu])

  const selectDfu = async () => {
    const d = await chooseDfuDevice()
    if (d) {
      setDfu(d)
      setStatus({ text: 'Found the board in DFU mode.' })
    }
  }

  // ---- the receiver's questions, asked on Prepare ---------------------------
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const armed = useVehicleStore((s) => s.armed)
  const [target, setTarget] = useState<ElrsTargetConfig | null>(null)
  const [versions, setVersions] = useState<ElrsVersion[]>([])
  // Offered from the last board: both must match the pilot's transmitter.
  const remembered = usePreferencesStore((s) => s.elrs)
  const [version, setVersion] = useState(remembered.version)
  const [region, setRegion] = useState<ElrsRegion>(remembered.region)
  const remember = () => {
    if (board.receiver) usePreferencesStore.getState().setElrs({ version, region })
  }
  // The binding phrase lives only here: never stored, never logged.
  const [phrase, setPhrase] = useState('')

  useEffect(() => {
    if (!board.receiver || target) return
    let live = true
    void elrsTarget(board.receiver.target)
      .then(async (t) => {
        const list = await elrsVersions(t)
        if (!live) return
        setTarget(t)
        setVersions(list)
        // A remembered version ExpressLRS no longer lists is not offered.
        setVersion((v) => (list.some((x) => x.version === v) ? v : ''))
      })
      .catch((e: unknown) => live && setStatus({ text: message(e), tone: 'bad' }))
    return () => {
      live = false
    }
  }, [board.receiver, target])

  // ---- firmware: one image over DFU, then ArduPilot's own port -------------
  const step = (text: string) => setStatus({ text })

  const runFirmware = async () => {
    remember()
    setStage('firmware')
    setNeedPort(false)
    setRunning(true)
    setFailed(false)
    try {
      let port: SerialPort | null
      if (!flashed.current) {
        await installBlank(release, option, dfu ?? undefined, step)
        flashed.current = true
        step('Starting ArduPilot…')
        port = await firmwarePort(null)
      } else {
        port = await grantedArduPilotPort()
      }
      // A browser sees only ports it was granted, and its chooser needs a press
      // from the last few seconds; the flash took far longer than that.
      if (!port) {
        setRunning(false)
        setNeedPort(true)
        setStatus({ text: 'Press Continue and select the flight controller’s port.' })
        return
      }
      step('Connecting…')
      await connectArduPilot(port)
      setRunning(false)
      advance('firmware')
    } catch (e) {
      fail(e)
    }
  }

  const connectByHand = async () => {
    setNeedPort(false)
    setRunning(true)
    setFailed(false)
    try {
      await connectArduPilot()
      setRunning(false)
      if (replug) await restore()
      else advance(stage)
    } catch (e) {
      fail(e)
    }
  }

  // ---- receiver ------------------------------------------------------------
  // A wait of known length fills the bar over its length, so a quiet stretch
  // still shows it is moving and how long is left.
  const timedBar = useRef<ReturnType<typeof setInterval> | null>(null)
  const stopTimedBar = () => {
    if (timedBar.current) clearInterval(timedBar.current)
    timedBar.current = null
  }
  const startTimedBar = (ms: number) => {
    stopTimedBar()
    const start = Date.now()
    setProgress(0)
    timedBar.current = setInterval(() => {
      setProgress(Math.min(100, Math.round((100 * (Date.now() - start)) / ms)))
    }, 200)
  }
  useEffect(() => stopTimedBar, [])

  const job = () => ({
    boardId: board.boardId,
    wiring: board.receiver!,
    passthroughProtocol: option.passthroughProtocol,
    onStep: (s: PassthroughStep) => {
      setStatus({ text: RECEIVER_LABEL[s] })
      stopTimedBar()
      if (s === 'wait-exit') startTimedBar((PASS_TIMEOUT_S + 2) * 1000)
      else setProgress(s === 'esptool' ? 0 : null)
    },
  })

  const runReceiver = async () => {
    const chosen = versions.find((v) => v.version === version)
    if (!chosen || !target || !board.receiver) return
    setRunning(true)
    setFailed(false)
    try {
      setStatus({ text: `Downloading ExpressLRS ${chosen.version}…` })
      const images = await receiverImages(
        { target, version: chosen, region, phrase, baud: board.receiver.baud },
        (done, total) => setProgress(Math.round((100 * done) / total)),
      )
      setProgress(null)
      const outcome = await flashReceiver(job(), images, setProgress)
      setProgress(null)
      if (outcome.kind === 'replug') {
        stopTimedBar()
        setProgress(null)
        setRunning(false)
        setReplug(true)
        setStatus({ text: 'Waiting for the flight controller to come back…' })
        // The one thing in the setup the pilot has to do mid-way, possibly
        // after looking away during the long write.
        const voice = usePreferencesStore.getState().voice
        if (voice.enabled) void playTone('info', voice.tones.info)
        return
      }
      setRunning(false)
      if (outcome.esptoolError) {
        setFailed(true)
        setStatus({
          text: `The receiver was not written: ${outcome.esptoolError} The flight controller settings were restored.`,
          tone: 'bad',
        })
        return
      }
      remember()
      advance('receiver')
    } catch (e) {
      fail(e)
    }
  }

  // The answers were given on Prepare, so the receiver is written as soon as
  // ArduPilot is connected.
  const autoReceiver = useRef(false)
  useEffect(() => {
    if (stage !== 'receiver' || autoReceiver.current) return
    if (!connected || armed || !target || !version) return
    autoReceiver.current = true
    void runReceiver()
  })

  const restore = async () => {
    setRunning(true)
    try {
      await restoreReceiverSettings(job())
      setReplug(false)
      setRunning(false)
      advance('receiver')
    } catch (e) {
      fail(e)
    }
  }

  // After the replug, the board returns as a port this app already holds.
  const replugAbort = useRef<AbortController | null>(null)
  useEffect(() => {
    if (!replug || running) return
    const abort = new AbortController()
    replugAbort.current = abort
    void nextArduPilotPort(10 * 60 * 1000, abort.signal).then(async (port) => {
      if (!port || abort.signal.aborted) return
      setRunning(true)
      setStatus({ text: 'Connecting…' })
      try {
        await connectArduPilot(port)
        await restore()
      } catch (e) {
        fail(e)
      }
    })
    return () => abort.abort()
  }, [replug, running])

  // ---- what the dialog shows -------------------------------------------------
  const top = guide?.top
  const pictures: { pic: BoardPicture; marks: Mark[] }[] = !guide
    ? []
    : stage === 'prepare'
      ? [{ pic: guide.top, marks: foundInDfu ? [] : guide.dfuMarks }]
      : replug
        ? [{ pic: guide.top, marks: [guide.usbMark] }]
        : top
          ? [{ pic: top, marks: [] }]
          : []

  const flashing = stage === 'firmware' && running && flashPhase in FLASH_LABEL
  // Erase and install waits for the version; a tooltip alone went unseen.
  const needVersion = stage === 'prepare' && !!dfu && !!board.receiver && !version
  const stateText = flashing
    ? FLASH_LABEL[flashPhase]!
    : needVersion
      ? 'Found the board in DFU mode. Select the ExpressLRS version.'
      : status.text
  const stateTone = flashing ? undefined : status.tone
  const stateProgress = flashing ? flashProgress : progress

  const unanswered = !!board.receiver && !version

  let primary: ReactNode = null
  if (stage === 'prepare') {
    primary =
      !dfu && !isElectron() ? (
        <LaButton variant="primary" onClick={() => void selectDfu()}>
          Select board
        </LaButton>
      ) : (
        <LaButton
          variant="danger"
          disabled={!dfu || unanswered}
          title={dfu && unanswered ? 'Select the ExpressLRS version first.' : undefined}
          onClick={() => void runFirmware()}
        >
          Erase and install
        </LaButton>
      )
  } else if (stage === 'firmware') {
    primary = needPort ? (
      <LaButton variant="primary" disabled={running} onClick={() => void connectByHand()}>
        Continue
      </LaButton>
    ) : (
      <LaButton
        variant="primary"
        disabled={running || !failed}
        onClick={() => {
          if (flashed.current) return void runFirmware()
          // A stalled DFU device needs a reconnect, so this retry starts
          // from Prepare.
          setDfu(null)
          setFailed(false)
          setStage('prepare')
        }}
      >
        Retry
      </LaButton>
    )
  } else if (stage === 'receiver') {
    primary = replug ? (
      <LaButton
        variant="primary"
        disabled={running || !replugLate}
        onClick={() => void connectByHand()}
      >
        Connect
      </LaButton>
    ) : (
      <LaButton
        variant="primary"
        disabled={running || !failed || !version || !connected || armed}
        title={
          armed
            ? 'Disarm the vehicle first.'
            : !connected
              ? 'Connect to the flight controller first.'
              : undefined
        }
        onClick={() => void runReceiver()}
      >
        Retry
      </LaButton>
    )
  } else {
    primary = (
      <LaButton variant="primary" onClick={() => onClose('Setup complete.')}>
        Done
      </LaButton>
    )
  }

  const form = (disabled: boolean) => (
    <ReceiverForm
      versions={versions}
      version={version}
      onVersion={setVersion}
      region={region}
      onRegion={setRegion}
      phrase={phrase}
      onPhrase={setPhrase}
      disabled={disabled}
    />
  )

  return (
    <LaModal
      open
      wide
      title={`Set up ${board.name}`}
      actions={
        <>
          {stage !== 'check' && (
            <LaButton variant="ghost" disabled={running} onClick={() => onClose(null)}>
              Cancel
            </LaButton>
          )}
          {primary}
        </>
      }
    >
      <ol className="lab-stages" aria-label="Steps">
        {stages.map((s, i) => (
          <li
            key={s}
            className={`lab-stage${s === stage ? ' lab-stage--on' : ''}${stages.indexOf(stage) > i ? ' lab-stage--done' : ''}`}
            aria-current={s === stage ? 'step' : undefined}
          >
            <span className="fw-step__n" aria-hidden="true">
              {i + 1}
            </span>
            {STAGE_LABEL[s]}
          </li>
        ))}
      </ol>

      {/* Its slot is kept on every step, so the picture under it never moves. */}
      <p className="lab-note">
        {stage !== 'prepare'
          ? ''
          : board.receiver
            ? `This will flash the bootloader, ${productLabel(option)} firmware, and ExpressLRS receiver firmware. Existing firmware and settings will be erased.`
            : `This will flash the bootloader and ${productLabel(option)} firmware. Existing firmware and settings will be erased.`}
      </p>

      <div className="lab-body">
        <div className="lab-pictures">
          {pictures.map(({ pic, marks }, i) => (
            <Picture key={i} pic={pic} marks={marks} />
          ))}
        </div>

        <div className="lab-lines">
          {stage === 'prepare' && (
            // Everything the setup needs from the pilot is on this one step, so
            // the rest runs to the check without another press.
            <div className="lab-prepare">
              {guide && !foundInDfu && (
                <ol className="lab-instructions">
                  {guide.prepare.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
              )}
              {board.receiver && form(false)}
            </div>
          )}
          {stage === 'firmware' && (
            <dl className="lab-facts">
              <Fact label="Board" value={board.name} />
              <Fact label="Firmware" value={productLabel(option)} />
              <Fact label="Release" value={release.version} />
            </dl>
          )}
          {/* The answers open again only to retry a failed write. */}
          {stage === 'receiver' && !replug && form(running || !failed)}
          {stage === 'receiver' && replug && (
            <div className="lab-replug" role="alert">
              <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
                <path fill="currentColor" d={mdiUsb} />
              </svg>
              <p>Disconnect USB, then connect it again.</p>
            </div>
          )}
          {stage === 'check' && (
            <SetupSummary
              firmware={productLabel(option)}
              receiver={board.receiver ? `ExpressLRS ${version}` : null}
            />
          )}
        </div>
      </div>

      <div className="fw-state">
        <span className={`fw-state__text${stateTone ? ` fw-state__text--${stateTone}` : ''}`}>
          {stateText}
        </span>
        {stateProgress !== null && (
          <div className="cal-progress" role="progressbar" aria-valuenow={stateProgress}>
            <div className="cal-progress__fill" style={{ width: `${stateProgress}%` }} />
          </div>
        )}
      </div>
    </LaModal>
  )
}

function Picture({ pic, marks }: { pic: BoardPicture; marks: Mark[] }) {
  const h = 1000 / pic.aspect
  return (
    <div className="lab-picture" style={{ aspectRatio: String(pic.aspect) }}>
      <img src={pic.src} alt="" draggable={false} />
      <svg viewBox={`0 0 1000 ${h}`} aria-hidden="true">
        {/* A dark ring under the light one, so a mark reads on a white part
            (the USB socket) as well as on the board. */}
        {marks.map((m, i) => (
          <circle key={`u${i}`} cx={m.x} cy={m.y} r={36} className="lab-mark lab-mark--under" />
        ))}
        {marks.map((m, i) => (
          <circle key={i} cx={m.x} cy={m.y} r={36} className="lab-mark" />
        ))}
        {marks.map(
          (m, i) =>
            m.label && (
              <text
                key={`t${i}`}
                x={m.label.side === 'left' ? m.x - 52 : m.x + 52}
                y={m.y + 13}
                textAnchor={m.label.side === 'left' ? 'end' : 'start'}
                className="lab-mark-label"
              >
                {m.label.text}
              </text>
            ),
        )}
      </svg>
    </div>
  )
}

function Fact({
  label,
  value,
  tone,
}: {
  label: string
  value: string | null
  /** A status color for the value: green for done, red for failed. */
  tone?: 'ok' | 'bad'
}) {
  return (
    <div className="lab-fact">
      <dt>{label}</dt>
      <dd className={tone ? `lab-fact--${tone}` : undefined}>{value ?? '—'}</dd>
    </div>
  )
}

function ReceiverForm({
  versions,
  version,
  onVersion,
  region,
  onRegion,
  phrase,
  onPhrase,
  disabled,
}: {
  versions: ElrsVersion[]
  version: string
  onVersion: (v: string) => void
  region: ElrsRegion
  onRegion: (r: ElrsRegion) => void
  phrase: string
  onPhrase: (p: string) => void
  disabled: boolean
}) {
  // Hidden until asked for, each time the form appears: someone may be
  // watching the screen.
  const [shown, setShown] = useState(false)
  return (
    <div className="lab-form">
      {/* No version is preselected: it must match the transmitter's major
          version, and only the pilot knows that. */}
      <label className="lab-field">
        <span>ExpressLRS version</span>
        <LaSelect
          value={version}
          disabled={disabled || versions.length === 0}
          onChange={(e) => onVersion(e.target.value)}
        >
          <option value="" disabled>
            {versions.length === 0 ? 'Loading…' : 'Select a version'}
          </option>
          {versions.map((v) => (
            <option key={v.version} value={v.version}>
              {v.version}
            </option>
          ))}
        </LaSelect>
      </label>
      <label className="lab-field">
        <span>Regulatory domain</span>
        <LaSelect
          value={region}
          disabled={disabled}
          onChange={(e) => onRegion(e.target.value as ElrsRegion)}
        >
          <option value="FCC">ISM 2.4 GHz</option>
          <option value="LBT">EU LBT 2.4 GHz</option>
        </LaSelect>
      </label>
      <label className="lab-field">
        <span>Binding phrase</span>
        <span className="lab-secret">
          <input
            className="la-input"
            type={shown ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            value={phrase}
            onChange={(e) => onPhrase(e.target.value)}
          />
          <button
            type="button"
            className="lab-secret__toggle"
            aria-label={shown ? 'Hide binding phrase' : 'Show binding phrase'}
            title={shown ? 'Hide' : 'Show'}
            aria-pressed={shown}
            disabled={disabled}
            onClick={() => setShown((s) => !s)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="currentColor" d={shown ? mdiEyeOff : mdiEye} />
            </svg>
          </button>
        </span>
      </label>
    </div>
  )
}

/**
 * What the setup did, once every step has passed. The parameters line is the
 * receiver step's read-back: every value the restore wrote was read from the
 * board again and matched. A board without a receiver has none written.
 */
function SetupSummary({ firmware, receiver }: { firmware: string; receiver: string | null }) {
  return (
    <dl className="lab-facts">
      <Fact label="Flight controller" value={`Flashed with ${firmware}`} tone="ok" />
      {receiver && <Fact label="Receiver" value={`Flashed with ${receiver}`} tone="ok" />}
      {receiver && <Fact label="Parameters" value="Validated" tone="ok" />}
    </dl>
  )
}
