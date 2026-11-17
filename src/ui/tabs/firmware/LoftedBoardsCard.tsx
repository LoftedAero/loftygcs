import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LaButton, LaCard, LaSelect } from '../../components/La'
import { boardForId, releaseLabels, type BoardEntry } from '../../../protocol/lofted-boards'
import { detectBoard, updateFirmware } from '../../../services/board-setup'
import { catalog } from '../../../services/lofted-catalog'
import { PortCancelledError } from '../../../transport/web-serial'
import { useBoardSetupStore, type HeldBoard } from '../../../stores/board-setup-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { useFlashStore } from '../../../stores/flash-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { hasWebSerial } from '../../../env'
import Step from './FwStep'
import BoardSetupWizard, { FLASH_LABEL } from './BoardSetupWizard'
import { PRODUCTS, ProductIcon } from './lofted-products'

// Lofted Aero's own flight controllers, from the catalog published with
// their firmware (services/lofted-catalog.ts). Beside the Firmware card
// because a blank board starts here, with nothing connected; a board that is
// connected is recognized by its board id, as is one the Firmware card holds
// in its bootloader. One button serves both, and the board decides which: one
// found in DFU gets the wizard (bootloader, firmware, receiver), one found
// running ArduPilot gets its firmware updated in place, with nothing more to
// answer, and none found gets the wizard's guide to DFU.

type Status = { text: string; tone?: 'bad' }

/** How long a finished flash stays confirmed on the state line. */
const CONFIRM_MS = 5000

export default function LoftedBoardsCard() {
  const [entries, setEntries] = useState<BoardEntry[] | null>(null)
  const [status, setStatus] = useState<Status>({ text: 'Reading the firmware catalog…' })
  const [boardKey, setBoardKey] = useState('')
  const [optionId, setOptionId] = useState('')
  const [releaseName, setReleaseName] = useState('')
  /** The wizard is open; with the board when the press found it in DFU. */
  const [wizard, setWizard] = useState<{ dfu: USBDevice | null } | null>(null)
  const [updating, setUpdating] = useState(false)

  const connected = useConnectionStore((s) => s.phase === 'connected')
  const boardId = useVehicleStore((s) => s.boardId)
  const armed = useVehicleStore((s) => s.armed)
  const held = useBoardSetupStore((s) => s.held)
  const flashPhase = useFlashStore((s) => s.phase)
  const flashProgress = useFlashStore((s) => s.progress)

  useEffect(() => {
    // Effects run even when the card draws nothing; a build that cannot
    // flash a board does not need the catalog.
    if (!hasWebSerial()) return
    let live = true
    void catalog().then(
      (list) => {
        if (!live) return
        setEntries(list)
        setStatus({ text: '' })
      },
      (e: unknown) =>
        live && setStatus({ text: e instanceof Error ? e.message : String(e), tone: 'bad' }),
    )
    return () => {
      live = false
    }
  }, [])

  const list = useMemo(() => entries ?? [], [entries])
  const attached = connected
    ? boardForId(list, boardId)
    : held
      ? boardForId(list, held.boardId)
      : null
  // A recognized board answers the first question outright.
  const entry = attached ?? list.find((e) => e.board.id === boardKey) ?? list[0] ?? null

  // The tiles this board has a build for, in any release.
  const enabled = useMemo(() => {
    const ids = new Set<string>()
    for (const r of entry?.releases ?? []) for (const f of r.board.firmware) ids.add(f.id)
    return ids
  }, [entry])
  const offered = PRODUCTS.filter((p) => enabled.has(p.id))
  // Picked, as on the Firmware card, since the builds are different aircraft;
  // a board with one build has nothing to pick.
  const option =
    offered.find((p) => p.id === optionId) ?? (offered.length === 1 ? offered[0]! : null)

  const releases = useMemo(
    () =>
      (entry?.releases ?? [])
        .map((r, index) => ({ ...r, index }))
        .filter((r) => option && r.board.firmware.some((f) => f.id === option.id)),
    [entry, option],
  )
  const release = releases.find((r) => r.release.name === releaseName) ?? releases[0] ?? null
  const firmware = release?.board.firmware.find((f) => f.id === option?.id) ?? null

  // The release box's room for text, so a label that would be clipped is
  // shortened instead (releaseLabels). Measured again when the box resizes
  // (compact mode) and once the app's font has loaded.
  const [releaseRoom, setReleaseRoom] = useState<{ width: number; font: string } | null>(null)
  useLayoutEffect(() => {
    const el = document.getElementById('lab-release')
    if (!el) return
    const measure = () => {
      const cs = getComputedStyle(el)
      setReleaseRoom({
        width: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
        font: `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
      })
    }
    measure()
    const resized = new ResizeObserver(measure)
    resized.observe(el)
    void document.fonts?.ready.then(measure)
    return () => resized.disconnect()
  }, [])
  const labels = useMemo(() => {
    const ctx = releaseRoom ? document.createElement('canvas').getContext('2d') : null
    if (ctx && releaseRoom) ctx.font = releaseRoom.font
    const fits = (label: string) =>
      !ctx || !releaseRoom || ctx.measureText(label).width <= releaseRoom.width
    return releaseLabels(
      releases.map((r) => r.release),
      fits,
    )
  }, [releases, releaseRoom])

  if (!hasWebSerial()) return null

  const otherVehicle = connected && !attached
  const installBlocked =
    connected && armed
      ? 'Disarm the vehicle first.'
      : otherVehicle
        ? 'Disconnect the vehicle first.'
        : null

  // A finished flash is confirmed on the state line, which then goes back to
  // what it says before a press.
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const confirm = (text: string) => {
    setStatus({ text })
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    confirmTimer.current = setTimeout(() => {
      setStatus((s) => (s.text === text ? { text: '' } : s))
    }, CONFIRM_MS)
  }

  const close = (done: string | null) => {
    setWizard(null)
    if (done) confirm(done)
  }

  // The press is the whole of an update: the board, the firmware and the
  // release are on the card beside it. A board not yet recognized is looked
  // for first, and what is found decides between an update and the wizard.
  const flash = async () => {
    if (!release || !firmware) return
    const { board } = release
    setUpdating(true)
    // The restore dialog and the Firmware card's state line stay out of it.
    useBoardSetupStore.getState().setBusy(true)
    const step = (text: string) => setStatus({ text })
    try {
      // A recognized board is connected, or held by the Firmware card.
      let inBootloader: HeldBoard | undefined = connected ? undefined : (held ?? undefined)
      let found = false
      if (!attached) {
        const what = await detectBoard(step)
        if (what.kind !== 'bootloader') {
          step('')
          setWizard({ dfu: what.kind === 'dfu' ? what.device : null })
          return
        }
        inBootloader = what.board
        found = true
      }
      const back = await updateFirmware(release.release, board, firmware, step, inBootloader, found)
      // The board has left its bootloader; the Firmware card lets go of it.
      if (inBootloader && !found) useBoardSetupStore.getState().setHeld(null)
      if (back) confirm('Flashing complete.')
      else setStatus({ text: 'Flashing complete. Connect to the board.' })
    } catch (e) {
      if (e instanceof PortCancelledError) setStatus({ text: '' })
      else setStatus({ text: e instanceof Error ? e.message : String(e), tone: 'bad' })
    } finally {
      useFlashStore.getState().setPhase('idle')
      useBoardSetupStore.getState().setBusy(false)
      setUpdating(false)
    }
  }

  const flashing = updating && flashPhase in FLASH_LABEL

  return (
    <LaCard className="fw-card" title="Lofted Aero Flight Controllers">
      <Step n={1} label="Board" htmlFor="lab-board">
        {list.length > 1 && !attached ? (
          <LaSelect
            id="lab-board"
            value={entry?.board.id ?? ''}
            disabled={updating}
            onChange={(e) => setBoardKey(e.target.value)}
          >
            {list.map((e) => (
              <option key={e.board.id} value={e.board.id}>
                {e.board.name}
              </option>
            ))}
          </LaSelect>
        ) : (
          <div id="lab-board" className="la-readout" data-placeholder="—">
            {entry
              ? attached
                ? `${entry.board.name} · ${connected ? 'connected' : 'in bootloader'}`
                : entry.board.name
              : ''}
          </div>
        )}
      </Step>

      <Step n={2} label="Firmware" wide>
        {/* The Firmware card's vehicle strip: dimmed where this board has no
            build, so the strip keeps its shape from board to board. */}
        <div className="fw-vehicles" role="radiogroup" aria-label="Firmware">
          {PRODUCTS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={option?.id === id}
              disabled={!enabled.has(id) || updating}
              className={`fw-vehicle${option?.id === id ? ' fw-vehicle--on' : ''}`}
              onClick={() => {
                setOptionId(id)
                setReleaseName('')
              }}
            >
              <ProductIcon id={id} />
              <span className="fw-vehicle__name">{label}</span>
            </button>
          ))}
        </div>
      </Step>

      <Step n={3} label="Release" htmlFor="lab-release">
        <LaSelect
          id="lab-release"
          value={release?.release.name ?? ''}
          disabled={releases.length === 0 || updating}
          onChange={(e) => setReleaseName(e.target.value)}
        >
          {releases.map((r, i) => (
            <option key={r.release.name} value={r.release.name}>
              {labels[i]}
            </option>
          ))}
        </LaSelect>
        <LaButton
          variant="primary"
          disabled={!firmware || !!installBlocked || updating}
          title={installBlocked ?? undefined}
          onClick={() => void flash()}
        >
          Flash board
        </LaButton>
      </Step>

      <div className="fw-state">
        <span className={`fw-state__text${status.tone && !flashing ? ' fw-state__text--bad' : ''}`}>
          {flashing
            ? FLASH_LABEL[flashPhase]
            : status.text ||
              (!entry
                ? ''
                : !option
                  ? 'Pick the firmware.'
                  : attached
                    ? ''
                    : 'Plug in the board to proceed. For first-time flashing, connect in DFU mode.')}
        </span>
        {flashing && (
          <div className="cal-progress" role="progressbar" aria-valuenow={flashProgress}>
            <div className="cal-progress__fill" style={{ width: `${flashProgress}%` }} />
          </div>
        )}
      </div>

      {wizard && entry && release && firmware && (
        <BoardSetupWizard
          entry={entry}
          releaseIndex={release.index}
          option={firmware}
          dfu={wizard.dfu}
          onClose={close}
        />
      )}
    </LaCard>
  )
}
