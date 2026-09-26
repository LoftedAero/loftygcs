import { useEffect, useState } from 'react'
import { LaLinkButton } from '../components/La'
import { BRAND } from '../../brand'

// The footer used to carry Write Params, Revert and Refresh for every Setup
// tab: parameter edits staged anywhere and were sent from here. Every tab now
// either writes as it is used or carries Revert and Write on the title row of
// the card that owns the edit (`CardParamActions`), so the footer's copy was
// a second answer to a question each screen already answers -- and on a
// screen with its own Write, two buttons that looked alike and sent different
// sets. An edit left staged when a write-as-you-go field fails is still
// covered: leaving the page with anything unwritten asks, and offers "Write
// and continue" (`UnsavedChangesModal`).
//
// Flight commands lived here once too, and moved onto the Fly screen beside
// the HUD they act on.

export default function ActionBar() {
  const [version, setVersion] = useState(__APP_VERSION__)

  useEffect(() => {
    // The packaged Electron app's version is authoritative (it can differ
    // from the bundled build's during development).
    window.loftgcs?.app.getVersion().then(setVersion)
  }, [])

  return (
    <footer className="la-actionbar">
      <span className="la-actionbar__spacer"></span>
      {/* Permanent, quiet, and next to the version it qualifies: someone who
          dismissed the first-run notice a week ago should still be able to
          tell at a glance which kind of build they are looking at. */}
      {BRAND.preview && <span className="app-preview-chip">Preview</span>}
      <LaLinkButton
        onClick={() => {
          if (window.loftgcs) window.loftgcs.app.openExternal(BRAND.repoUrl)
          else window.open(BRAND.repoUrl, '_blank', 'noopener')
        }}
      >
        {BRAND.name} v{version}
      </LaLinkButton>
    </footer>
  )
}
