// Getting a .bin off the user's disk and into the review screen.
//
// An input element and a FileReader rather than a native dialog, for the
// same reason mission files use one: the identical code runs in the browser
// build and in Electron, and the privileged preload surface stays as small
// as it is. A log never leaves the machine either way -- everything below
// happens in the page.

import { useLogStore } from '../stores/log-store'

/** Prompt for a log file and load it. Resolves once it has been read. */
export function openLogFile(): Promise<void> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.bin,.BIN,.log'
    // Attached rather than floating: a detached input's click is ignored by
    // some browsers, and nothing can reach it from a test either.
    input.style.display = 'none'
    document.body.appendChild(input)

    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      input.remove()
      resolve()
    }
    // Dismissing the picker fires cancel, not change. Without this the
    // promise never settles and the button stays disabled for good.
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
        // Parsing blocks for about 150 ms per ten megabytes. Yielding first
        // lets the "Parsing…" state actually paint, rather than the window
        // freezing on the old one and then jumping to the result.
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
