import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { mdiFolderOpen, mdiOpenInNew } from '@mdi/js'
import { LaButton, LaCard, LaModal, LaSelect } from '../../components/La'
import { useFlashStore, type LoadedApj, type LoadedHex } from '../../../stores/flash-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import {
  allPlatforms,
  describeBoard,
  isTunedFor,
  loadFirmwareManifest,
  manifestAvailable,
  platformsFor,
  preferredPlatform,
  releasesFor,
  vehiclesIn,
  withBootloaderUrl,
  type FirmwareOption,
  type ReleaseChoice,
} from '../../../services/firmware-manifest'
import { parseApj } from '../../../protocol/bootloader/apj'
import { parseIntelHex } from '../../../protocol/bootloader/intel-hex'
import {
  bootBoard,
  flashDfu,
  flashSerial,
  identifyBoard,
  identifyDfu,
  rebootToBootloader,
  RebootedError,
  type DfuBoardInfo,
} from '../../../services/flash'
import { PortCancelledError } from '../../../transport/web-serial'
import { isFailsafe, MAV_STATE } from '../flight/hud-draw'
import type { BootloaderInfo } from '../../../protocol/bootloader/px-uploader'
import { isElectron, openExternal } from '../../../env'
import VehicleIcon from './VehicleIcon'

const BUSY_PHASES = new Set(['sync', 'erase', 'program', 'verify', 'reboot', 'leave'])
const PHASE_LABEL: Record<string, string> = {
  sync: 'Contacting the bootloader…',
  erase: 'Erasing the old firmware…',
  program: 'Writing the new firmware…',
  verify: 'Verifying the new firmware…',
  reboot: 'Rebooting the board…',
  leave: 'Leaving DFU mode…',
  done: 'Flashed. The board is rebooting into the new firmware.',
  error: 'Failed',
}
const KB = 1024

/**
 * Board first, then firmware (QGroundControl's ordering). How the board is
 * found decides how it is flashed: one that answers the ArduPilot bootloader
 * handshake takes the `.apj` over serial; one that enumerates as the STM32
 * DFU loader (most boards the first time, since they ship with Betaflight,
 * INAV or nothing) takes the `_with_bl.hex` over USB.
 *
 * Knowing the board first lets the file picker, the vehicle tiles and the
 * release list offer only what fits it.
 */
export default function FirmwareTab() {
  return (
    <div className="fw-tab">
      <FirmwareCard />
    </div>
  )
}

/**
 * The card's state line: plain for progress, warn for a choice with
 * consequences, bad for a failure. No green, which is reserved for aircraft
 * status.
 */
type Status = { text: string; tone?: 'warn' | 'bad' }

/** The detected board and how it will be flashed. */
type Board =
  { mode: 'serial'; info: BootloaderInfo; port: SerialPort } | { mode: 'dfu'; info: DfuBoardInfo }

function useManifest() {
  const [options, setOptions] = useState<FirmwareOption[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!manifestAvailable()) return
    loadFirmwareManifest()
      .then(setOptions)
      .catch((e) => setError(e instanceof Error ? e.message : 'manifest load failed'))
  }, [])
  return { options, error }
}

/** A release's channel as shown on screen. */
function channelWord(o: ReleaseChoice): string {
  if (o.channel === 'beta') return 'beta'
  if (o.channel === 'dev') return 'dev'
  return o.current ? 'latest stable' : 'stable'
}

async function fetchImage(url: string): Promise<string> {
  const bridge = window.loftgcs
  if (!bridge) throw new Error('downloading needs the desktop app')
  return new TextDecoder().decode(await bridge.app.fetchFirmware(url))
}

// --- the card ----------------------------------------------------------

function FirmwareCard() {
  const { options, error: manifestError } = useManifest()
  const all = useMemo(() => options ?? [], [options])

  const apj = useFlashStore((s) => s.apj)
  const hex = useFlashStore((s) => s.hex)
  const phase = useFlashStore((s) => s.phase)
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const armed = useVehicleStore((s) => s.armed)
  const systemStatus = useVehicleStore((s) => s.systemStatus)
  const busy = BUSY_PHASES.has(phase)

  /**
   * Why this board must not be rebooted right now, or null. Detecting
   * reboots the board into its bootloader, so it is refused while armed, and
   * while MAV_STATE is ACTIVE (flying) or CRITICAL/EMERGENCY (failsafe).
   */
  const blocked = armed
    ? 'The vehicle is armed. Disarm before detecting a board — detecting reboots it into its bootloader.'
    : connected && systemStatus === MAV_STATE.active
      ? 'The vehicle is flying. Detecting a board reboots it into its bootloader.'
      : connected && isFailsafe(systemStatus)
        ? 'The vehicle is in a failsafe. Detecting a board reboots it into its bootloader.'
        : null

  const [board, setBoard] = useState<Board | null>(null)
  const [platform, setPlatform] = useState('')
  const [vehicle, setVehicle] = useState<string | null>(null)
  const [pinnedVersion, setPinnedVersion] = useState<string | null>(null)

  // The current step of a multi-step action, shown on the state line.
  const [step, setStep] = useState('')
  const [loadError, setLoadError] = useState('')
  // Guidance set by an action (opening the build page), cleared by the next.
  const [note, setNote] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const [confirmInfo, setConfirmInfo] = useState<BootloaderInfo | null>(null)
  const confirmResolve = useRef<((ok: boolean) => void) | null>(null)
  const [dfuPending, setDfuPending] = useState<LoadedHex | null>(null)

  const [target, setTarget] = useState<{ platforms: string[]; note: string } | null>(null)
  const targetResolve = useRef<((p: string | null) => void) | null>(null)
  const askForTarget = (platforms: string[], why: string) =>
    new Promise<string | null>((resolve) => {
      targetResolve.current = resolve
      setTarget({ platforms, note: why })
    })
  const answerTarget = (p: string | null) => {
    setTarget(null)
    targetResolve.current?.(p)
    targetResolve.current = null
  }

  const dropImage = () => useFlashStore.getState().setFirmware(null)

  // A board identified over serial sits in its bootloader running nothing
  // until it is flashed or told to boot, so it is booted on unmount.
  const boardRef = useRef<Board | null>(null)
  boardRef.current = board
  useEffect(() => {
    return () => {
      const b = boardRef.current
      if (b?.mode === 'serial') void bootBoard(b.port).catch(() => {})
    }
  }, [])

  // ---- derived -----------------------------------------------------------
  const vehicles = useMemo(() => vehiclesIn(all), [all])
  const boardId = board?.mode === 'serial' ? board.info.boardId : null
  const boardName = board?.mode === 'serial' ? describeBoard(all, board.info.boardId) : null

  // Only vehicles this board has a build for. Serial: by id, which is exact.
  // DFU: by the target the user named. Nothing until a board is known.
  const enabled = useMemo(() => {
    const set = new Set<string>()
    if (!board) return set
    for (const v of vehicles) {
      const has =
        board.mode === 'serial'
          ? platformsFor(all, v.vehicle, board.info.boardId).length > 0
          : platform !== '' && releasesFor(all, v.vehicle, platform).length > 0
      if (has) set.add(v.vehicle)
    }
    return set
  }, [all, vehicles, board, platform])

  // Releases for this board and vehicle.
  const releases = useMemo<ReleaseChoice[]>(() => {
    if (!vehicle || !platform) return []
    const seen = new Map<string, ReleaseChoice>()
    for (const o of releasesFor(all, vehicle, platform, boardId)) {
      const key = `${o.version}|${o.channel}`
      const had = seen.get(key)
      if (had) had.current ||= o.current
      else seen.set(key, { version: o.version, channel: o.channel, current: o.current })
    }
    return [...seen.values()]
  }, [all, vehicle, platform, boardId])
  const selected = pinnedVersion
    ? releases.find((r) => r.version === pinnedVersion)
    : (releases.find((r) => r.current) ?? releases[0])
  const vehicleLabel = vehicles.find((v) => v.vehicle === vehicle)?.label ?? vehicle
  const image = board?.mode === 'dfu' ? hex : apj

  // ---- the board --------------------------------------------------------

  /**
   * Identify the board and how to flash it. First a silent look for a DFU
   * device (the desktop shell pre-grants `0483:DF11`). Then serial: a
   * connected vehicle is rebooted over the live link, otherwise the user
   * picks a port. If serial fails, DFU is tried again with a prompt, since
   * the browser cannot see an ungranted device silently.
   */
  const detectBoard = async () => {
    setLoadError('')
    setNote('')
    // Detecting again releases the previous board back to its firmware, but
    // only after the new detect finishes and only if it found a different
    // board (see `finally`). Releasing first would reboot the board out of
    // its bootloader just as its port is requested.
    const previous = board
    let kept: SerialPort | undefined
    try {
      if (previous) {
        setBoard(null)
        setVehicle(null)
        setPlatform('')
        setPinnedVersion(null)
        dropImage()
      }
      if (blocked) {
        setLoadError(blocked)
        return
      }
      // Connected and idle: detecting still reboots the vehicle and drops
      // the link, so ask first.
      if (connected && !(await confirmReboot())) return
      setStep('Looking for a board in DFU mode…')
      const dfu = await identifyDfu({ askForPort: false }).catch(() => null)
      if (dfu) return await adoptDfu(dfu)

      if (connected) {
        setStep('Rebooting to the bootloader…')
        await rebootToBootloader().catch(() => {})
      }
      setStep('Checking the board…')
      let info: Awaited<ReturnType<typeof identifyBoard>>
      try {
        info = await identifyBoard({
          askForPort: true,
          reboot: true,
          rebooted: connected,
          onStep: setStep,
        })
      } catch (err) {
        // The silent DFU look only sees devices this origin was already
        // granted, so a first-time DFU board is invisible to it. Ask here,
        // after any serial failure: a board in DFU mode has no serial port.
        setStep('')
        const viaUsb = await identifyDfu({ askForPort: true }).catch(() => null)
        if (viaUsb) return await adoptDfu(viaUsb)
        // A dismissed chooser is not an error.
        if (err instanceof PortCancelledError) return
        setLoadError(
          err instanceof RebootedError
            ? 'Could not detect board, please retry.'
            : 'No bootloader answered on that port, and no board is in DFU mode. A board that has never run ArduPilot must be in DFU mode: hold its BOOT button while plugging it in.',
        )
        return
      }
      dropImage()
      setVehicle(null)
      setPinnedVersion(null)
      setPlatform('')
      setBoard({ mode: 'serial', info, port: info.port })
      kept = info.port
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'could not identify the board')
    } finally {
      setStep('')
      // Web Serial returns the same SerialPort object for the same device, so
      // a board detected again stays in its bootloader and a replaced one is
      // booted back.
      if (previous?.mode === 'serial' && previous.port !== kept) {
        await bootBoard(previous.port).catch(() => {})
      }
    }
  }

  /**
   * DFU has no board id, so the user picks the target. Without a manifest
   * (the web build) there is nothing to pick from, so the board is adopted
   * untargeted and only a file can be flashed.
   */
  const adoptDfu = async (dfu: DfuBoardInfo) => {
    setStep('')
    const targets = allPlatforms(all)
    const chosen =
      targets.length === 0
        ? ''
        : await askForTarget(
            targets,
            `${Math.round(dfu.totalBytes / KB)} KB of flash, and no board id to read — pick the target this board was built for.`,
          )
    if (chosen === null) return
    dropImage()
    setVehicle(null)
    setPinnedVersion(null)
    setPlatform(chosen)
    setBoard({ mode: 'dfu', info: dfu })
  }

  const [rebootAsk, setRebootAsk] = useState(false)
  const rebootResolve = useRef<((ok: boolean) => void) | null>(null)
  const confirmReboot = () =>
    new Promise<boolean>((resolve) => {
      rebootResolve.current = resolve
      setRebootAsk(true)
    })
  const answerReboot = (ok: boolean) => {
    setRebootAsk(false)
    rebootResolve.current?.(ok)
    rebootResolve.current = null
  }

  // ---- the firmware -----------------------------------------------------

  /**
   * Choosing a vehicle picks the platform for a serial board from its id,
   * asking only when the id fits several builds or none.
   */
  const chooseVehicle = async (v: string) => {
    if (!board) return
    setVehicle(v)
    setPinnedVersion(null)
    dropImage()
    setLoadError('')
    setNote('')
    if (board.mode !== 'serial') return
    const id = board.info.boardId
    let p = preferredPlatform(all, v, id)
    if (!p) {
      const fits = platformsFor(all, v, id)
      p = await askForTarget(
        fits.length > 0 ? fits : allPlatforms(all),
        fits.length > 0
          ? `Board id ${id} has ${fits.length} builds. Pick the one for this board.`
          : `Board id ${id} is not in the build list. Pick the target it was built for.`,
      )
      if (!p) {
        setVehicle(null)
        return
      }
    }
    setPlatform(p)
  }

  /** Reject a file of the wrong kind for this board. */
  const openFile = async (file: File) => {
    if (!board) return
    setLoadError('')
    setNote('')
    const isHex = /\.hex$/i.test(file.name)
    if (board.mode === 'dfu' && !isHex) {
      setLoadError(
        'This board is in DFU mode and has no ArduPilot bootloader, so it takes the _with_bl.hex, not an .apj. The build page offers both.',
      )
      return
    }
    if (board.mode === 'serial' && isHex) {
      setLoadError(
        'This board has the ArduPilot bootloader and takes the .apj. A _with_bl.hex goes over DFU — hold BOOT while plugging in, then Detect board again, if that is what you want.',
      )
      return
    }
    try {
      const text = await file.text()
      const store = useFlashStore.getState()
      store.setFirmware(null)
      store.setFirmware(
        isHex
          ? { kind: 'hex', segments: parseIntelHex(text), label: file.name }
          : { kind: 'apj', apj: await parseApj(text), label: file.name },
      )
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'could not read firmware file')
    }
  }

  const flash = async () => {
    if (!board) return
    setLoadError('')
    setNote('')
    try {
      let ready = image
      if (!ready) {
        if (!vehicle || !platform) return
        const build = releasesFor(all, vehicle, platform, boardId).find((r) =>
          selected ? r.version === selected.version && r.channel === selected.channel : r.current,
        )
        if (!build) {
          setLoadError(`No ${selected?.version ?? 'current'} build for ${platform}.`)
          return
        }
        if (board.mode === 'dfu') {
          setStep(
            `Downloading ${build.vehicleLabel} ${build.version} for ${build.platform}, with bootloader…`,
          )
          const img: LoadedHex = {
            kind: 'hex',
            segments: parseIntelHex(await fetchImage(withBootloaderUrl(build.url))),
            label: `${build.vehicleLabel} ${build.version} · ${build.platform} (with bootloader)`,
          }
          useFlashStore.getState().setFirmware(img)
          ready = img
        } else {
          setStep(`Downloading ${build.vehicleLabel} ${build.version} for ${build.platform}…`)
          const img: LoadedApj = {
            kind: 'apj',
            apj: await parseApj(await fetchImage(build.url)),
            label: `${build.vehicleLabel} ${build.version} · ${build.platform}`,
          }
          useFlashStore.getState().setFirmware(img)
          ready = img
        }
      }
      setStep('')
      if (ready.kind === 'hex') return flashOverDfu(ready)
      // Reuse the port the board was identified on rather than asking again.
      if (board.mode !== 'serial') return
      await flashSerial(
        ready.apj,
        (found) => {
          setConfirmInfo(found)
          return new Promise<boolean>((resolve) => {
            confirmResolve.current = resolve
          })
        },
        board.port,
      )
      // `flashSerial` reboots the board after a flash and after a cancel, so
      // either way it has left its bootloader and its port handle is stale.
      setBoard(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'flash failed')
    } finally {
      setStep('')
    }
  }

  const flashOverDfu = (img: LoadedHex) => {
    // Only a with-bootloader image starts at the flash base. ArduPilot's
    // make_intel_hex.py writes either that or an app-only .hex at the
    // board's reserve offset.
    const start = img.segments[0]?.address ?? 0
    if (start !== 0x08000000) {
      setLoadError(
        `That .hex starts at 0x${start.toString(16)}, so it is an application-only image with no bootloader in it. DFU needs the _with_bl.hex.`,
      )
      return
    }
    const top = img.segments.reduce((t, s) => Math.max(t, s.address + s.data.length), 0)
    if (board?.mode === 'dfu' && top > board.info.startAddress + board.info.totalBytes) {
      setLoadError(
        'That image needs more flash than this board has — it is built for a different board.',
      )
      return
    }
    setDfuPending(img)
  }

  const answerConfirm = (ok: boolean) => {
    setConfirmInfo(null)
    confirmResolve.current?.(ok)
    confirmResolve.current = null
  }

  // ---- what the screen says ---------------------------------------------
  const boardLine =
    board?.mode === 'serial'
      ? `${boardName ?? `Board id ${board.info.boardId}`} · id ${board.info.boardId} · bootloader rev ${board.info.blRev}`
      : board?.mode === 'dfu'
        ? [`DFU mode`, platform || `${Math.round(board.info.totalBytes / KB)} KB flash`].join(' · ')
        : undefined

  // `blocked` ranks just below the errors and above everything
  // informational, so a safety line is never hidden behind a notice.
  const status: Status = manifestError
    ? { text: manifestError, tone: 'bad' }
    : loadError
      ? { text: loadError, tone: 'bad' }
      : blocked
        ? { text: blocked, tone: 'warn' }
        : step
          ? { text: step }
          : note
            ? { text: note }
            : image
              ? {
                  text: `${image.label} — ${image.kind === 'hex' ? 'over DFU' : 'over the ArduPilot bootloader'}`,
                }
              : !manifestAvailable()
                ? { text: 'The web version of this app can only flash firmware from a file.' }
                : !options
                  ? { text: 'Loading the build list…' }
                  : !board
                    ? {
                        text: 'Detect a board to flash. A board that has never run ArduPilot must be in DFU mode.',
                      }
                    : vehicle && !isTunedFor(vehicle)
                      ? {
                          text: `This app is tested for Copter and Plane — some functions may not work properly for ${vehicleLabel}.`,
                          tone: 'warn',
                        }
                      : { text: vehicle ? '' : 'Pick a vehicle type.' }

  const canFlash = !!board && !busy && !step && (!!image || (!!vehicle && !!platform && !!selected))

  return (
    <LaCard className="fw-card" title="Firmware">
      {/* Detect sits in the row it fills. */}
      <Step n={1} label="Board">
        {/* Not orange: the card's one primary action is the flash. */}
        <LaButton
          variant={board ? 'ghost' : 'secondary'}
          disabled={busy || !!step || !!blocked}
          title={blocked ?? undefined}
          onClick={() => void detectBoard()}
        >
          Detect board
        </LaButton>
        <div className="la-readout" data-placeholder="—" title={boardLine}>
          {boardLine}
        </div>
      </Step>

      <Step n={2} label="Vehicle" wide>
        {/* A loaded file takes precedence, so no tile shows as chosen.
            `vehicle` is kept so clicking a tile drops the file and returns
            to that vehicle's builds. */}
        <VehicleStrip
          vehicles={vehicles}
          enabled={enabled}
          chosen={image ? null : vehicle}
          onChoose={(v) => void chooseVehicle(v)}
          canOpenFile={!!board}
          onOpenFile={() => fileRef.current?.click()}
          onCustomBuild={() => {
            openExternal('https://custom.ardupilot.org')
            setNote(
              board?.mode === 'dfu'
                ? 'From the build page, download the _with_bl.hex — this board has no ArduPilot bootloader.'
                : board
                  ? 'From the build page, download the .apj.'
                  : 'Detect the board first: the build page offers an .apj and a _with_bl.hex, and which one you need depends on the board.',
            )
          }}
        />
      </Step>

      {/* Preselected with the current release. A loaded file replaces the
          list and disables it, since `flash` writes the file instead; a
          vehicle tile is the way back. Flash sits beside it so every row
          shares one right edge. */}
      <Step n={3} label="Release" htmlFor="fw-release">
        <LaSelect
          id="fw-release"
          value={image ? FILE_CHOICE : (selected?.version ?? '')}
          disabled={!!image || releases.length === 0}
          onChange={(e) => {
            setPinnedVersion(e.target.value)
            dropImage()
          }}
        >
          {image ? (
            <option value={FILE_CHOICE}>{image.label}</option>
          ) : (
            <>
              {releases.length === 0 && <option value="">—</option>}
              {releases.map((r) => (
                <option key={`${r.version}|${r.channel}`} value={r.version}>
                  {r.version} · {channelWord(r)}
                </option>
              ))}
            </>
          )}
        </LaSelect>
        <LaButton variant="primary" disabled={!canFlash} onClick={() => void flash()}>
          Flash board
        </LaButton>
      </Step>

      <StateLine status={status} />

      <input
        ref={fileRef}
        type="file"
        accept={board?.mode === 'dfu' ? '.hex' : '.apj'}
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void openFile(f)
          e.target.value = ''
        }}
      />

      <TargetModal target={target} onAnswer={answerTarget} />

      {rebootAsk && (
        <LaModal
          open
          title="Reboot this vehicle to detect it?"
          actions={
            <>
              <LaButton variant="ghost" onClick={() => answerReboot(false)}>
                Cancel
              </LaButton>
              <LaButton variant="danger" onClick={() => answerReboot(true)}>
                Reboot and detect
              </LaButton>
            </>
          }
        >
          <p>
            Detecting a board reboots it into its bootloader, so the telemetry link will drop and
            the vehicle will stop running its firmware until it is flashed or detection is finished.
          </p>
          <p>Nothing is erased by detecting.</p>
        </LaModal>
      )}

      {confirmInfo && apj && (
        <LaModal
          open
          title="Erase and flash this board?"
          actions={
            <>
              <LaButton variant="ghost" onClick={() => answerConfirm(false)}>
                Cancel
              </LaButton>
              <LaButton variant="danger" onClick={() => answerConfirm(true)}>
                Erase and flash
              </LaButton>
            </>
          }
        >
          <p>
            Board id {confirmInfo.boardId} (bootloader rev {confirmInfo.blRev},{' '}
            {Math.round(confirmInfo.fwSize / 1024)} KB flash) matches the firmware:
          </p>
          <p>
            <strong>{apj.label}</strong> — {apj.apj.image.length} bytes
            {apj.apj.version && `, ${apj.apj.version}`}
          </p>
          <p>The current firmware on this board will be erased.</p>
        </LaModal>
      )}

      {dfuPending && (
        <LaModal
          open
          title="Erase and flash via DFU?"
          actions={
            <>
              <LaButton variant="ghost" onClick={() => setDfuPending(null)}>
                Cancel
              </LaButton>
              <LaButton
                variant="danger"
                onClick={() => {
                  const go = dfuPending
                  setDfuPending(null)
                  void flashDfu(go.segments)
                    .then(() => setBoard(null))
                    .catch(() => {
                      // The store already carries the error message.
                    })
                }}
              >
                Erase and flash
              </LaButton>
            </>
          }
        >
          <p>
            <strong>{dfuPending.label}</strong> —{' '}
            {dfuPending.segments.reduce((a, s) => a + s.data.length, 0).toLocaleString()} bytes
            starting at 0x{(dfuPending.segments[0]?.address ?? 0).toString(16).padStart(8, '0')}.
          </p>
          <p>
            <strong>DFU has no board-id check</strong>: make certain this image is built for this
            board.
          </p>
        </LaModal>
      )}
    </LaCard>
  )
}

/**
 * The release dropdown's value while a file is loaded. It is only ever the
 * sole option of a disabled select, so no handler sees it.
 */
const FILE_CHOICE = 'file'

/**
 * One numbered step and its controls. Numbered because each step depends on
 * the previous one. Controls share one width (`--fw-control-w`) so they line
 * up on a single left edge.
 */
function Step({
  n,
  label,
  htmlFor,
  wide,
  children,
}: {
  n: number
  label: string
  htmlFor?: string
  /** The vehicle strip is a grid of its own and takes the whole column. */
  wide?: boolean
  children: ReactNode
}) {
  const Label = htmlFor ? 'label' : 'span'
  return (
    <div className="fw-step">
      <Label className="fw-step__label" {...(htmlFor ? { htmlFor } : {})}>
        <span className="fw-step__n" aria-hidden="true">
          {n}
        </span>
        {label}
      </Label>
      <div className={`fw-step__body${wide ? ' fw-step__body--wide' : ''}`}>{children}</div>
    </div>
  )
}

/**
 * Asks which build target this board is, when its id fits several builds or
 * none, or over DFU where there is no id. A flat, searchable list of
 * ArduPilot's targets.
 */
function TargetModal({
  target,
  onAnswer,
}: {
  target: { platforms: string[]; note: string } | null
  onAnswer: (p: string | null) => void
}) {
  const [filter, setFilter] = useState('')
  useEffect(() => {
    if (target) setFilter('')
  }, [target])
  if (!target) return null
  const shown = target.platforms.filter((p) =>
    p.toLowerCase().includes(filter.trim().toLowerCase()),
  )
  return (
    <LaModal
      open
      title="Which board is this?"
      actions={
        <LaButton variant="ghost" onClick={() => onAnswer(null)}>
          Cancel
        </LaButton>
      }
    >
      <p>{target.note}</p>
      <input
        className="la-input"
        autoFocus
        placeholder="Search targets"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <ul className="fw-targets">
        {shown.map((p) => (
          <li key={p}>
            <button type="button" className="fw-target" onClick={() => onAnswer(p)}>
              {p}
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="fw-targets__none">No target matches that.</li>}
      </ul>
    </LaModal>
  )
}

/**
 * The vehicle tiles, plus two action tiles. A vehicle tile is disabled until
 * a board is known and when the board has no build for it.
 */
function VehicleStrip({
  vehicles,
  enabled,
  chosen,
  onChoose,
  canOpenFile,
  onOpenFile,
  onCustomBuild,
}: {
  vehicles: { vehicle: string; label: string }[]
  enabled: ReadonlySet<string>
  chosen: string | null
  onChoose: (v: string) => void
  canOpenFile: boolean
  onOpenFile: () => void
  onCustomBuild: () => void
}) {
  return (
    <div className="fw-vehicles">
      {/* `display: contents`, so the radios lay out in the parent grid while
          staying grouped. The action tiles after it are not radios. */}
      <div className="fw-vehicles__group" role="radiogroup" aria-label="Vehicle">
        {vehicles.map(({ vehicle: v, label }) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={chosen === v}
            disabled={!enabled.has(v)}
            className={`fw-vehicle${chosen === v ? ' fw-vehicle--on' : ''}`}
            onClick={() => onChoose(v)}
          >
            <VehicleIcon vehicle={v} />
            <span className="fw-vehicle__name">{label}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="fw-vehicle fw-vehicle--action"
        title="Open a firmware file"
        disabled={!canOpenFile}
        onClick={onOpenFile}
      >
        <svg
          className="fw-vehicle__icon"
          viewBox="0 0 24 24"
          width="40"
          height="40"
          aria-hidden="true"
        >
          <path fill="currentColor" d={mdiFolderOpen} />
        </svg>
        <span className="fw-vehicle__name">Open file</span>
      </button>
      {isElectron() && (
        <button
          type="button"
          className="fw-vehicle fw-vehicle--action"
          title="Build a custom firmware at custom.ardupilot.org"
          onClick={onCustomBuild}
        >
          <svg
            className="fw-vehicle__icon"
            viewBox="0 0 24 24"
            width="40"
            height="40"
            aria-hidden="true"
          >
            <path fill="currentColor" d={mdiOpenInNew} />
          </svg>
          <span className="fw-vehicle__name">Custom build</span>
        </button>
      )}
    </div>
  )
}

// --- the state line ---------------------------------------------------

/**
 * Status and flash progress share one always-rendered row, so the card does
 * not change height. A running flash takes the row over.
 */
function StateLine({ status }: { status: Status }) {
  const phase = useFlashStore((s) => s.phase)
  const progress = useFlashStore((s) => s.progress)
  const error = useFlashStore((s) => s.error)
  const mine = phase !== 'idle'

  if (mine) {
    return (
      <div className="fw-state">
        <span className={`fw-state__text${phase === 'error' ? ' fw-state__text--bad' : ''}`}>
          {phase === 'error' ? (error ?? 'Failed') : (PHASE_LABEL[phase] ?? phase)}
        </span>
        <div className="cal-progress" role="progressbar" aria-valuenow={progress}>
          <div className="cal-progress__fill" style={{ width: `${progress}%` }} />
        </div>
      </div>
    )
  }
  return (
    <div className="fw-state">
      <span className={`fw-state__text${status.tone ? ` fw-state__text--${status.tone}` : ''}`}>
        {status.text}
      </span>
    </div>
  )
}
