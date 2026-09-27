// Getting a .bin off the user's disk and into the review screen.
//
// An input element and a FileReader rather than a native dialog, so the same
// code runs in the browser and in Electron without widening the preload
// surface.

import { useLogStore } from '../stores/log-store'

/** Prompt for a log file and load it. Resolves once it has been read. */
export function openLogFile(): Promise<void> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.bin,.BIN,.log'
    // Attached to the document: some browsers ignore a detached input's
    // click, and tests cannot reach one.
    input.style.display = 'none'
    document.body.appendChild(input)

    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      input.remove()
      resolve()
    }
    // Dismissing the picker fires cancel, not change.
    input.oncancel = done

    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return done()
      const store = useLogStore.getState()
      store.setStatus({ kind: 'reading', name: file.name, got: 0, total: file.size })

      const reader = new FileReader()
      reader.onprogress = (e) => {
        if (e.lengthComputable) {
          useLogStore
            .getState()
            .setStatus({ kind: 'reading', name: file.name, got: e.loaded, total: e.total })
        }
      }
      reader.onerror = () => {
        useLogStore.getState().setStatus({ kind: 'error', text: `Could not read ${file.name}.` })
        done()
      }
      reader.onload = () => {
        const buffer = reader.result
        if (!(buffer instanceof ArrayBuffer)) {
          useLogStore.getState().setStatus({ kind: 'error', text: 'That file came back empty.' })
          return done()
        }
        // Parsing blocks for about 150 ms per ten megabytes; yield first so
        // the "Parsing…" state paints.
        useLogStore.getState().setStatus({ kind: 'parsing', name: file.name })
        setTimeout(() => {
          useLogStore.getState().loadBytes(file.name, new Uint8Array(buffer))
          done()
        }, 0)
      }
      reader.readAsArrayBuffer(file)
    }

    input.click()
  })
}
