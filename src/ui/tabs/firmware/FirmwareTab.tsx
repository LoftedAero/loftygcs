import { useEffect, useMemo, useRef, useState } from 'react'
import { LaButton, LaCard, LaField, LaHint, LaModal, LaSelect } from '../../components/La'
import { useFlashStore } from '../../../stores/flash-store'
import { useConnectionStore } from '../../../stores/connection-store'
import {
  loadFirmwareManifest,
  manifestAvailable,
  withBootloaderUrl,
  type FirmwareOption,
} from '../../../services/firmware-manifest'
import { parseApj } from '../../../protocol/bootloader/apj'
import { parseIntelHex } from '../../../protocol/bootloader/intel-hex'
import { flashDfu, flashSerial, rebootToBootloader } from '../../../services/flash'
import type { BootloaderInfo } from '../../../protocol/bootloader/px-uploader'
import { isElectron } from '../../../env'

const BUSY_PHASES = new Set(['sync', 'erase', 'program', 'verify', 'reboot', 'leave'])
const PHASE_LABEL: Record<string, string> = {
  sync: 'Contacting bootloader…',
  erase: 'Erasing',
  program: 'Programming',
  verify: 'Verifying',
  reboot: 'Rebooting',
  leave: 'Leaving DFU',
  done: 'Done',
  error: 'Failed',
}

export default function FirmwareTab() {
  return (
    <>
      <SourceCard />
      <SerialFlashCard />
      <DfuCard />
    </>
  )
}

// --- picking / loading firmware --------------------------------------

function SourceCard() {
  const firmware = useFlashStore((s) => s.firmware)
  const [options, setOptions] = useState<FirmwareOption[] | null>(null)
  const [manifestError, setManifestError] = useState('')
  const [vehicle, setVehicle] = useState('Copter')
  const [channel, setChannel] = useState<'stable' | 'beta' | 'dev'>('stable')
  const [platform, setPlatform] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!manifestAvailable()) return
    loadFirmwareManifest()
      .then(setOptions)
      .catch((e) => setManifestError(e instanceof Error ? e.message : 'manifest load failed'))
  }, [])

  const vehicles = useMemo(
    () => [...new Set(options?.map((o) => o.vehicle) ?? [])].sort(),
    [options],
  )
  const platforms = useMemo(
    () =>
      [
        ...new Set(
          options?.filter((o) => o.vehicle === vehicle && o.channel === channel).map((o) => o.platform) ??
            [],
        ),
      ].sort(),
    [options, vehicle, channel],
  )
  const selected = options?.find(
    (o) => o.vehicle === vehicle && o.channel === channel && o.platform === platform,
  )

  const download = async () => {
    if (!selected || !window.loftgcs) return
    setBusy(true)
    setLoadError('')
    try {
      const bytes = await window.loftgcs.app.fetchFirmware(selected.url)
      const apj = await parseApj(new TextDecoder().decode(bytes))
      useFlashStore.getState().setFirmware({
        kind: 'apj',
        apj,
        label: `${selected.vehicle} ${selected.version} · ${selected.platform}`,
      })
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'download failed')
    } finally {
      setBusy(false)
    }
  }

  const downloadWithBl = async () => {
    if (!selected || !window.loftgcs) return
    setBusy(true)
    setLoadError('')
    try {
      const bytes = await window.loftgcs.app.fetchFirmware(withBootloaderUrl(selected.url))
      const segments = parseIntelHex(new TextDecoder().decode(bytes))
      useFlashStore.getState().setFirmware({
        kind: 'hex',
        segments,
        label: `${selected.vehicle} ${selected.version} · ${selected.platform} (with bootloader)`,
      })
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'download failed')
    } finally {
      setBusy(false)
    }
  }

  const onFile = async (file: File) => {
    setLoadError('')
    try {
      const text = await file.text()
      if (file.name.endsWith('.hex')) {
        useFlashStore.getState().setFirmware({
          kind: 'hex',
          segments: parseIntelHex(text),
          label: file.name,
        })
      } else {
        useFlashStore.getState().setFirmware({
          kind: 'apj',
          apj: await parseApj(text),
          label: file.name,
        })
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'could not read firmware file')
    }
  }

  return (
    <LaCard
      title="Firmware"
      note={
        isElectron()
          ? 'Official builds come from firmware.ardupilot.org; custom builds from custom.ardupilot.org load as files.'
          : 'The browser cannot download from firmware.ardupilot.org directly — fetch the file there and open it here, or use the desktop app.'
      }
    >
      {options && (
        <>
          <LaField label="Vehicle" htmlFor="fw-vehicle">
            <LaSelect id="fw-vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
              {vehicles.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </LaSelect>
          </LaField>
          <LaField label="Channel" htmlFor="fw-channel">
            <LaSelect
              id="fw-channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value as 'stable' | 'beta' | 'dev')}
            >
              <option value="stable">Stable</option>
              <option value="beta">Beta</option>
              <option value="dev">Dev (latest)</option>
            </LaSelect>
          </LaField>
          <LaField label="Board" htmlFor="fw-board">
            <input
              id="fw-board"
              className="la-input"
              list="fw-board-list"
              placeholder="Type to search boards"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            />
          </LaField>
          <datalist id="fw-board-list">
            {platforms.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <div className="la-row">
            <LaButton variant="secondary" disabled={!selected || busy} onClick={() => void download()}>
              {busy ? 'Downloading…' : 'Download firmware'}
            </LaButton>
            <LaButton
              variant="ghost"
              disabled={!selected || busy}
              title="The bootloader-included image, for DFU recovery"
              onClick={() => void downloadWithBl()}
            >
              Download with bootloader
            </LaButton>
          </div>
          {selected && (
            <LaHint>
              {selected.version} for {selected.platform} (board id {selected.boardId})
            </LaHint>
          )}
        </>
      )}
      {manifestError && <LaHint error>{manifestError}</LaHint>}
      <div className="la-row">
        <input
          ref={fileRef}
          type="file"
          accept=".apj,.hex"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onFile(f)
            e.target.value = ''
          }}
        />
        <LaButton variant="ghost" onClick={() => fileRef.current?.click()}>
          Open firmware file…
        </LaButton>
      </div>
      {loadError && <LaHint error>{loadError}</LaHint>}
      <LaField label="Loaded">
        <div className="la-readout" data-placeholder="No firmware loaded">
          {firmware
            ? firmware.kind === 'apj'
              ? `${firmware.label} — ${firmware.apj.image.length} bytes, board id ${firmware.apj.boardId}`
              : `${firmware.label} — ${firmware.segments.reduce((a, s) => a + s.data.length, 0)} bytes at 0x${firmware.segments[0]?.address.toString(16)}`
            : undefined}
        </div>
      </LaField>
    </LaCard>
  )
}

// --- shared progress -------------------------------------------------

function FlashProgress() {
  const phase = useFlashStore((s) => s.phase)
  const progress = useFlashStore((s) => s.progress)
  const log = useFlashStore((s) => s.log)
  const error = useFlashStore((s) => s.error)
  const logRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])
  if (phase === 'idle' && log.length === 0) return null
  return (
    <>
      <LaField label={PHASE_LABEL[phase] ?? phase}>
        <div className="cal-progress la-grow" role="progressbar" aria-valuenow={progress}>
          <div className="cal-progress__fill" style={{ width: `${progress}%` }} />
        </div>
      </LaField>
      {log.length > 0 && (
        <textarea ref={logRef} className="la-log" readOnly rows={5} value={log.join('\n')} />
      )}
      {error && <LaHint error>{error}</LaHint>}
      {phase === 'done' && <LaHint>Flash complete. Reconnect from the app bar.</LaHint>}
    </>
  )
}

// --- serial bootloader path ------------------------------------------

function SerialFlashCard() {
  const firmware = useFlashStore((s) => s.firmware)
  const phase = useFlashStore((s) => s.phase)
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const busy = BUSY_PHASES.has(phase)
  const [confirmInfo, setConfirmInfo] = useState<BootloaderInfo | null>(null)
  const confirmResolve = useRef<((ok: boolean) => void) | null>(null)
  const [hint, setHint] = useState('')

  const startFlash = () => {
    if (firmware?.kind !== 'apj') return
    setHint('')
    void flashSerial(firmware.apj, (info) => {
      setConfirmInfo(info)
      return new Promise<boolean>((resolve) => {
        confirmResolve.current = resolve
      })
    }).catch(() => {
      // The store already carries the error message.
    })
  }

  const answerConfirm = (ok: boolean) => {
    setConfirmInfo(null)
    confirmResolve.current?.(ok)
    confirmResolve.current = null
  }

  return (
    <LaCard
      title="Flash over USB"
      subtitle="ArduPilot bootloader"
      note="The board id is checked against the firmware before anything is erased; the bootloader itself is never overwritten, so a failed flash is always recoverable by flashing again."
    >
      <p className="app-placeholder">
        1) Get the board into its bootloader — use the button below if connected, or plug USB in
        fresh (the bootloader listens for a few seconds at power-on). 2) Start the flash and pick
        the board's port.
      </p>
      <div className="la-row">
        <LaButton
          variant="ghost"
          disabled={!connected || busy}
          onClick={() => {
            setHint('Rebooting to bootloader; the port will re-enumerate.')
            void rebootToBootloader().catch((e) =>
              setHint(e instanceof Error ? e.message : 'reboot failed'),
            )
          }}
        >
          Reboot vehicle to bootloader
        </LaButton>
        <LaButton
          variant="primary"
          disabled={firmware?.kind !== 'apj' || busy}
          onClick={startFlash}
        >
          Select port and flash
        </LaButton>
      </div>
      <LaHint>{hint}</LaHint>
      {firmware && firmware.kind !== 'apj' && (
        <LaHint>Serial flashing takes an .apj — the loaded file is a hex image (use DFU below).</LaHint>
      )}
      <FlashProgress />
      {confirmInfo && firmware?.kind === 'apj' && (
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
            <strong>{firmware.label}</strong> — {firmware.apj.image.length} bytes
            {firmware.apj.version && `, ${firmware.apj.version}`}
          </p>
          <p>The current firmware and its configuration on this board will be erased.</p>
        </LaModal>
      )}
    </LaCard>
  )
}

// --- DFU recovery path -----------------------------------------------

function DfuCard() {
  const firmware = useFlashStore((s) => s.firmware)
  const phase = useFlashStore((s) => s.phase)
  const busy = BUSY_PHASES.has(phase)
  const [confirming, setConfirming] = useState(false)

  const start = () => {
    if (firmware?.kind !== 'hex') return
    setConfirming(false)
    void flashDfu(firmware.segments).catch(() => {
      // The store already carries the error message.
    })
  }

  return (
    <LaCard
      title="DFU recovery"
      subtitle="No bootloader required"
      note="For blank or bricked boards: this talks to the STM32's built-in ROM loader over USB and flashes the with-bootloader image. On Windows the DFU device must have the WinUSB driver (install with Zadig)."
    >
      <p className="app-placeholder">
        Hold the board's BOOT0 button (or bridge its DFU pads) while plugging in USB — it
        enumerates as "STM32 BOOTLOADER". Load a with-bootloader .hex above, then flash.
      </p>
      <div className="la-row">
        <LaButton
          variant="secondary"
          disabled={firmware?.kind !== 'hex' || busy}
          onClick={() => setConfirming(true)}
        >
          Flash via DFU
        </LaButton>
      </div>
      {firmware && firmware.kind !== 'hex' && (
        <LaHint>DFU takes a .hex image — the loaded file is an .apj (use the bootloader flash above).</LaHint>
      )}
      {confirming && firmware?.kind === 'hex' && (
        <LaModal
          open
          title="Erase and flash via DFU?"
          actions={
            <>
              <LaButton variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </LaButton>
              <LaButton variant="danger" onClick={start}>
                Erase and flash
              </LaButton>
            </>
          }
        >
          <p>
            <strong>{firmware.label}</strong> —{' '}
            {firmware.segments.reduce((a, s) => a + s.data.length, 0)} bytes starting at 0x
            {firmware.segments[0]?.address.toString(16)}.
          </p>
          <p>
            DFU cannot check the board id: make certain this image is built for this exact board.
            Everything on the chip, bootloader included, is replaced.
          </p>
        </LaModal>
      )}
    </LaCard>
  )
}
