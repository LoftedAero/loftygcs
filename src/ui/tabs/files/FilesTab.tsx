import { useEffect, useState } from 'react'
import { LaButton, LaCard, LaHint, LaInput, LaModal } from '../../components/La'
import { useConnectionStore } from '../../../stores/connection-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { parentPath, useFilesStore } from '../../../stores/files-store'
import {
  downloadEntry,
  enterDirectory,
  goUp,
  isMergedRoot,
  makeDirectory,
  openStart,
  refresh,
  removeEntry,
  renameEntry,
  uploadFile,
} from '../../../services/vehicle-files'
import type { FtpDirEntry } from '../../../protocol/ftp/mavftp'

// The vehicle's SD card, over MAVFTP.
//
// This is where the things ArduPilot keeps as files rather than parameters
// live: Lua scripts, OSD fonts, terrain tiles, the odd log or config. Until
// now getting a script onto a board meant pulling the card, which in the
// field means finding a laptop and a reader.
//
//   ┌────────────────────────────────┬──────────┐
//   │ /APM/scripts                   │ upload,  │
//   │ ..                             │ download,│
//   │ [D] logs                       │ new      │
//   │ [F] rangefinder.lua    1.4 kB  │ folder,  │
//   │                                │ delete   │
//   └────────────────────────────────┴──────────┘
//
// Deleting is the one destructive thing here and it asks first, naming what
// it is about to remove: there is no recycle bin on a flight controller,
// and a mis-clicked delete of a font or a script is a flight not flown.

export default function FilesTab() {
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const path = useFilesStore((s) => s.path)
  const entries = useFilesStore((s) => s.entries)
  const status = useFilesStore((s) => s.status)
  const transfer = useFilesStore((s) => s.transfer)
  const selectedName = useFilesStore((s) => s.selected)
  const select = useFilesStore((s) => s.select)
  const [confirming, setConfirming] = useState<FtpDirEntry | null>(null)
  const [newFolder, setNewFolder] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ entry: FtpDirEntry; to: string } | null>(null)
  // MAV_PROTOCOL_CAPABILITY_FTP. Zero capabilities means the vehicle never
  // answered AUTOPILOT_VERSION, which is not the same as saying no -- so
  // this only speaks up when it actually said no.
  const capabilities = useVehicleStore((s) => s.capabilities)
  const saysNoFtp = capabilities !== 0 && (capabilities & (1 << 11)) === 0

  // Listed on arrival rather than behind a button: an empty screen with a
  // "List" button on it is a screen that has told you nothing.
  useEffect(() => {
    if (connected) void openStart()
  }, [connected])

  const busy = status.kind === 'busy'
  // The root is ArduPilot's merged view of the filesystem and its virtual
  // mounts, and a file written there never appears in the listing. Better
  // to say so than to offer a transfer that silently does nothing.
  const atRoot = isMergedRoot(path)
  const selected = entries.find((e) => e.name === selectedName) ?? null

  if (!connected) {
    return (
      <LaCard title="Files" note="The vehicle's SD card, over MAVFTP.">
        <p className="app-placeholder">
          Connect a vehicle and this lists what is on its card — Lua scripts, OSD fonts, terrain
          tiles — with a way to put files there and take them off.
        </p>
      </LaCard>
    )
  }

  return (
    <div className="files">
      <div className="files__main">
        <div className="files__bar">
          <span className="files__path" title={path}>
            {path}
          </span>
          <LaButton
            variant="ghost"
            disabled={busy || path === '/'}
            onClick={() => void goUp()}
            title={`Up to ${parentPath(path)}`}
          >
            Up
          </LaButton>
        </div>

        <div className="files__scroll">
          <table className="files__table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Size</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr
                  key={e.name}
                  className={e.name === selectedName ? 'is-selected' : undefined}
                  onClick={() => select(e.name)}
                  onDoubleClick={() => {
                    if (e.kind === 'directory') void enterDirectory(e.name)
                  }}
                >
                  <td>
                    <span className="files__kind">{e.kind === 'directory' ? 'DIR' : 'FILE'}</span>
                    {e.name}
                  </td>
                  <td className="num">{e.kind === 'directory' ? '' : formatSize(e.size ?? 0)}</td>
                </tr>
              ))}
              {entries.length === 0 && !busy && (
                <tr>
                  <td colSpan={2}>Nothing here.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="app-col">
        <section className="app-col__group">
          <h3 className="app-col__head">This folder</h3>
          <LaButton variant="secondary" size="block" disabled={busy} onClick={() => void refresh()}>
            {busy ? 'Working…' : 'Refresh'}
          </LaButton>
          <LaButton
            variant="secondary"
            size="block"
            disabled={busy || !selected || selected.kind !== 'directory'}
            onClick={() => selected && void enterDirectory(selected.name)}
          >
            Open folder
          </LaButton>
          <LaHint>Double-click a folder to open it.</LaHint>
        </section>

        <section className="app-col__group">
          <h3 className="app-col__head">Transfer</h3>
          <LaButton
            variant="primary"
            size="block"
            disabled={busy || atRoot}
            onClick={() => pickAndUpload()}
            title={atRoot ? 'Open a folder first' : `Write a file into ${path}`}
          >
            Upload a file…
          </LaButton>
          {atRoot && <LaHint>Open a folder first: the root is a merged view, not a place.</LaHint>}
          <LaButton
            variant="secondary"
            size="block"
            disabled={busy || !selected || selected.kind !== 'file'}
            onClick={() => selected && void downloadEntry(selected)}
          >
            Download
          </LaButton>
          {transfer && (
            <>
              <p className="app-col__note">
                {transfer.dir === 'read' ? 'Reading' : 'Writing'} {transfer.name} —{' '}
                {formatSize(transfer.got)}
                {transfer.total > 0 && ` of ${formatSize(transfer.total)}`}
              </p>
              <progress
                className="log-progress"
                value={transfer.got}
                max={Math.max(1, transfer.total)}
                aria-label={`${transfer.dir === 'read' ? 'Downloading' : 'Uploading'} ${transfer.name}`}
              />
            </>
          )}
          {/* The number nobody guesses right: uploads are a round trip per
              239 bytes, so a script that copies instantly to an SD card
              takes visible seconds here. */}
          <LaHint>
            Writing has no burst mode, so it runs at about 8 kB a second over USB and far less over
            a radio.
          </LaHint>
        </section>

        <section className="app-col__group">
          <h3 className="app-col__head">Change</h3>
          <LaButton
            variant="secondary"
            size="block"
            disabled={busy || atRoot}
            onClick={() => setNewFolder('')}
          >
            New folder…
          </LaButton>
          {/* Renaming is how a Lua script is switched off without deleting
              it: ArduPilot only runs *.lua, so rangefinder.lua.off stays on
              the card and stops running. */}
          <LaButton
            variant="secondary"
            size="block"
            disabled={busy || !selected}
            onClick={() => selected && setRenaming({ entry: selected, to: selected.name })}
          >
            Rename…
          </LaButton>
          <LaButton
            variant="ghost"
            size="block"
            disabled={busy || !selected}
            onClick={() => selected && setConfirming(selected)}
          >
            Delete…
          </LaButton>
        </section>

        {saysNoFtp && (
          <LaHint error>
            This vehicle does not report MAVFTP support, so there is nothing here to browse.
          </LaHint>
        )}
        {status.kind === 'error' && <p className="app-col__note is-error">{status.text}</p>}
        {status.kind === 'done' && <p className="app-col__note">{status.text}</p>}
      </aside>

      {confirming && (
        <LaModal
          open
          narrow
          title={`Delete ${confirming.name}?`}
          actions={
            <div className="la-prompt-actions">
              <LaButton
                variant="danger"
                size="block"
                onClick={() => {
                  void removeEntry(confirming)
                  setConfirming(null)
                }}
              >
                Delete
              </LaButton>
              <LaButton variant="ghost" size="block" onClick={() => setConfirming(null)}>
                Cancel
              </LaButton>
            </div>
          }
        >
          <p className="app-col__note">
            {confirming.kind === 'directory'
              ? 'A folder can only be deleted when it is empty.'
              : 'There is no recycle bin on a flight controller: this is gone for good.'}
          </p>
        </LaModal>
      )}

      {renaming && (
        <LaModal
          open
          narrow
          title={`Rename ${renaming.entry.name}`}
          actions={
            <div className="la-prompt-actions">
              <LaButton
                variant="primary"
                size="block"
                disabled={renaming.to.trim() === '' || renaming.to === renaming.entry.name}
                onClick={() => {
                  void renameEntry(renaming.entry, renaming.to.trim())
                  setRenaming(null)
                }}
              >
                Rename
              </LaButton>
              <LaButton variant="ghost" size="block" onClick={() => setRenaming(null)}>
                Cancel
              </LaButton>
            </div>
          }
        >
          <LaInput
            autoFocus
            value={renaming.to}
            aria-label="New name"
            onChange={(e) => setRenaming({ entry: renaming.entry, to: e.target.value })}
          />
          <p className="app-col__note">Stays in {path}.</p>
        </LaModal>
      )}

      {newFolder !== null && (
        <LaModal
          open
          narrow
          title="New folder"
          actions={
            <div className="la-prompt-actions">
              <LaButton
                variant="primary"
                size="block"
                disabled={newFolder.trim() === ''}
                onClick={() => {
                  void makeDirectory(newFolder.trim())
                  setNewFolder(null)
                }}
              >
                Create
              </LaButton>
              <LaButton variant="ghost" size="block" onClick={() => setNewFolder(null)}>
                Cancel
              </LaButton>
            </div>
          }
        >
          <LaInput
            autoFocus
            value={newFolder}
            aria-label="Folder name"
            placeholder="scripts"
            onChange={(e) => setNewFolder(e.target.value)}
          />
          <p className="app-col__note">Created inside {path}.</p>
        </LaModal>
      )}
    </div>
  )
}

/** The file picker, kept out of the component so the button stays one line. */
function pickAndUpload(): void {
  const input = document.createElement('input')
  input.type = 'file'
  // Attached rather than floating: a detached input's click is ignored by
  // some browsers, and a test cannot reach one either.
  input.style.display = 'none'
  document.body.appendChild(input)
  input.onchange = () => {
    const file = input.files?.[0]
    input.remove()
    if (file) void uploadFile(file)
  }
  input.oncancel = () => input.remove()
  input.click()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
