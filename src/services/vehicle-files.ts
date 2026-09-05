import { connectionService } from './connection'
import { joinPath, parentPath, useFilesStore } from '../stores/files-store'
import type { FtpDirEntry } from '../protocol/ftp/mavftp'

// Browsing and editing the vehicle's SD card over MAVFTP.
//
// This is the screen that unlocks the things ArduPilot keeps as *files*
// rather than parameters: Lua scripts, OSD fonts, terrain tiles, and the
// odd config someone needs to pull off a card without a laptop and a card
// reader in the field.
//
// Writing is deliberately slower than reading and there is nothing to be
// done about it: there is no burst write, and ArduPilot serves one FTP
// request at a time, so a file goes up at 239 bytes a round trip. A 40 kB
// script is around twenty seconds over USB and minutes over a telemetry
// radio, which is why the size is shown before the upload and the progress
// during it.

/** Anything much bigger than a script is a mistake, not a transfer. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024

/**
 * Where to open.
 *
 * Real hardware mounts the card at /APM and that is where everything worth
 * browsing lives; SITL has no card and runs on the host filesystem, so its
 * root is the working directory. Probing in order costs one round trip on
 * hardware and gets the simulator right for free -- the same shape the log
 * download uses.
 */
const START_DIRS = ['/APM', '/']

/**
 * The FTP root is not an ordinary directory.
 *
 * ArduPilot presents it as a merged view of the real filesystem and its
 * virtual mounts (@ROMFS, @SYS, @PARAM). A file written there does not come
 * back in the listing -- verified against SITL, not assumed -- so writing
 * into it would look like a transfer that silently did nothing.
 */
export function isMergedRoot(path: string): boolean {
  return path === '/'
}

function describe(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  // The NAK codes are ArduPilot's own words and mean nothing to a pilot.
  if (/FileNotFound/.test(text)) return 'No such file or directory on the vehicle'
  if (/FileProtected/.test(text)) return 'The vehicle refused: the file is protected'
  if (/FileExists/.test(text)) return 'Something with that name is already there'
  if (/FailErrno/.test(text)) return 'The vehicle refused the operation'
  // The demo vehicle has no MAVFTP on purpose, and neither do some
  // third-party autopilots; "op 3 timed out" is true and tells nobody that.
  if (/timed out/.test(text)) return 'No answer — this vehicle may not support MAVFTP file access'
  return text
}

/** List a directory and show it. */
export async function listPath(path: string): Promise<void> {
  const store = useFilesStore.getState()
  store.setStatus({ kind: 'busy', text: `Listing ${path}…` })
  try {
    const entries = await connectionService.listFiles(path)
    useFilesStore.getState().setListing(path, entries)
    useFilesStore.getState().setStatus({ kind: 'idle' })
  } catch (err) {
    // The path shown is left alone on a failure: replacing it with a
    // directory that would not list loses the place you were standing.
    useFilesStore.getState().setStatus({ kind: 'error', text: describe(err) })
  }
}

export function enterDirectory(name: string): Promise<void> {
  return listPath(joinPath(useFilesStore.getState().path, name))
}

export function goUp(): Promise<void> {
  return listPath(parentPath(useFilesStore.getState().path))
}

export function refresh(): Promise<void> {
  return listPath(useFilesStore.getState().path)
}

/** Open the first directory this vehicle actually has. */
export async function openStart(): Promise<void> {
  const store = useFilesStore.getState()
  store.setStatus({ kind: 'busy', text: 'Listing…' })
  for (const dir of START_DIRS) {
    try {
      const entries = await connectionService.listFiles(dir)
      useFilesStore.getState().setListing(dir, entries)
      useFilesStore.getState().setStatus({ kind: 'idle' })
      return
    } catch (err) {
      // Only a missing directory is worth trying the next candidate for; a
      // timeout means the link is the problem and the next one will too.
      if (!(err instanceof Error && /FileNotFound/.test(err.message))) {
        useFilesStore.getState().setStatus({ kind: 'error', text: describe(err) })
        return
      }
    }
  }
  useFilesStore
    .getState()
    .setStatus({ kind: 'error', text: 'No readable directory on this vehicle' })
}

/**
 * Download a file and save it.
 *
 * Straight to disk rather than into the app: unlike a log, there is nothing
 * here that this station knows how to show, and the reason to fetch a
 * script or a font is to have it.
 */
export async function downloadEntry(entry: FtpDirEntry): Promise<void> {
  const store = useFilesStore.getState()
  const path = joinPath(store.path, entry.name)
  store.setTransfer({ name: entry.name, dir: 'read', got: 0, total: entry.size ?? 0 })
  store.setStatus({ kind: 'busy', text: `Reading ${entry.name}…` })
  try {
    const bytes = await connectionService.downloadFile(path)
    saveBytes(entry.name, bytes)
    useFilesStore.getState().setStatus({ kind: 'done', text: `Saved ${entry.name}` })
  } catch (err) {
    useFilesStore.getState().setStatus({ kind: 'error', text: describe(err) })
  } finally {
    useFilesStore.getState().setTransfer(null)
  }
}

/** Upload a local file into the directory being shown. */
export async function uploadFile(file: File): Promise<void> {
  const store = useFilesStore.getState()
  if (file.size > MAX_UPLOAD_BYTES) {
    store.setStatus({
      kind: 'error',
      text: `${file.name} is ${Math.round(file.size / 1024)} kB. Anything over ${
        MAX_UPLOAD_BYTES / 1024 / 1024
      } MB belongs on the card directly — over MAVFTP it would take hours.`,
    })
    return
  }
  const path = joinPath(store.path, file.name)
  const bytes = new Uint8Array(await file.arrayBuffer())
  store.setTransfer({ name: file.name, dir: 'write', got: 0, total: bytes.length })
  store.setStatus({ kind: 'busy', text: `Writing ${file.name}…` })
  try {
    await connectionService.uploadFile(path, bytes)
    useFilesStore.getState().setStatus({ kind: 'done', text: `Wrote ${file.name}` })
    await refresh()
  } catch (err) {
    useFilesStore.getState().setStatus({ kind: 'error', text: describe(err) })
  } finally {
    useFilesStore.getState().setTransfer(null)
  }
}

/** Delete a file or an empty directory. The caller confirms first. */
export async function removeEntry(entry: FtpDirEntry): Promise<void> {
  const store = useFilesStore.getState()
  const path = joinPath(store.path, entry.name)
  store.setStatus({ kind: 'busy', text: `Deleting ${entry.name}…` })
  try {
    if (entry.kind === 'directory') await connectionService.removeDirectory(path)
    else await connectionService.removeFile(path)
    useFilesStore.getState().setStatus({ kind: 'done', text: `Deleted ${entry.name}` })
    await refresh()
  } catch (err) {
    useFilesStore.getState().setStatus({ kind: 'error', text: describe(err) })
  }
}

export async function makeDirectory(name: string): Promise<void> {
  const store = useFilesStore.getState()
  store.setStatus({ kind: 'busy', text: `Creating ${name}…` })
  try {
    await connectionService.createDirectory(joinPath(store.path, name))
    useFilesStore.getState().setStatus({ kind: 'done', text: `Created ${name}` })
    await refresh()
  } catch (err) {
    useFilesStore.getState().setStatus({ kind: 'error', text: describe(err) })
  }
}

export async function renameEntry(entry: FtpDirEntry, to: string): Promise<void> {
  const store = useFilesStore.getState()
  const dir = store.path
  store.setStatus({ kind: 'busy', text: `Renaming ${entry.name}…` })
  try {
    await connectionService.renameFile(joinPath(dir, entry.name), joinPath(dir, to))
    useFilesStore.getState().setStatus({ kind: 'done', text: `Renamed to ${to}` })
    await refresh()
  } catch (err) {
    useFilesStore.getState().setStatus({ kind: 'error', text: describe(err) })
  }
}

function saveBytes(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(
    new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // Revoked on the next tick: revoking synchronously can beat the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
