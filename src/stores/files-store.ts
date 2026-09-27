import { create } from 'zustand'
import type { FtpDirEntry } from '../protocol/ftp/mavftp'

// The vehicle's own filesystem, as the Files screen sees it.
//
// One directory at a time rather than a cached tree: MAVFTP cannot report
// changes, and scripts, logging or a format can alter the card at any time.

export type FilesStatus =
  | { kind: 'idle' }
  | { kind: 'busy'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'done'; text: string }

export interface FileTransfer {
  name: string
  dir: 'read' | 'write'
  got: number
  total: number
}

interface FilesState {
  /** Absolute path of the directory shown, always starting with '/'. */
  path: string
  entries: FtpDirEntry[]
  status: FilesStatus
  /** The active download or upload, for the progress bar. */
  transfer: FileTransfer | null
  /** Name of the selected entry within `path`, or null. */
  selected: string | null

  setListing(path: string, entries: FtpDirEntry[]): void
  setStatus(status: FilesStatus): void
  setTransfer(transfer: FileTransfer | null): void
  select(name: string | null): void
}

export const useFilesStore = create<FilesState>((set) => ({
  path: '/',
  entries: [],
  status: { kind: 'idle' },
  transfer: null,
  selected: null,

  setListing(path, entries) {
    // Directories first, then by name; the vehicle returns filesystem order.
    const sorted = [...entries].sort(
      (a, b) =>
        Number(b.kind === 'directory') - Number(a.kind === 'directory') ||
        a.name.localeCompare(b.name),
    )
    set({ path, entries: sorted, selected: null })
  },
  setStatus(status) {
    set({ status })
  },
  setTransfer(transfer) {
    set({ transfer })
  },
  select(name) {
    set({ selected: name })
  },
}))

/** Join a directory and a name into an absolute path, without a double slash. */
export function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`
}

/** The directory above this one; the root is its own parent. */
export function parentPath(path: string): string {
  const at = path.lastIndexOf('/')
  if (at <= 0) return '/'
  return path.slice(0, at)
}
