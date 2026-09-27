import { useEffect, useState } from 'react'
import { LaLinkButton } from '../components/La'
import { BRAND } from '../../brand'

// The footer has no parameter actions: each Setup screen writes as it is used
// or from the card that owns the edit (`CardParamActions`). An edit left
// staged by a failed write-as-you-go field is caught when leaving the page
// (`UnsavedChangesModal`).

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
      {/* Always shown beside the version, after the first-run notice is
          dismissed. */}
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
