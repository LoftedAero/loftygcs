import { useEffect, useState } from 'react'
import { LaButton, LaLinkButton } from '../components/La'
import { BRAND } from '../../brand'
import { useUiStore, type TabId } from '../../stores/ui-store'
import { useParamStore } from '../../stores/param-store'
import { connectionService } from '../../services/connection'
import WriteParamsModal from './WriteParamsModal'

// Flight commands used to live here as well. They moved onto the Fly screen
// itself, next to the HUD they act on: the justification for keeping them in
// the footer was that it never scrolls away, and nothing on that screen
// scrolls, so the split only made the pilot look in two places.

// Setup sections with no parameters to edit: showing them a Write button
// would be offering an action the page cannot produce work for.
// Tabs with no Write of their own to offer. `sensors` is here because it
// writes as you go: a Write button there would be a second answer to a
// question the screen has already answered. The rule below still applies to
// it, and that is the point -- if one of those immediate writes fails, the
// value falls back to staged and the bar comes back to carry it, rather than
// leaving an edit on screen with no way to send it.
const PARAMLESS_TABS = new Set<TabId>(['overview', 'firmware', 'logs', 'sensors'])

// The bottom action bar: per-tab actions on the left, version link on the
// right. Write Params is the one orange action for the tabs that edit
// parameters -- everything those tabs stage goes to the vehicle here.
function ParamActions({ tab }: { tab: TabId }) {
  const dirtyCount = useParamStore((s) => s.dirtyCount)
  const writeBusy = useParamStore((s) => s.writeBusy)
  const loadState = useParamStore((s) => s.loadState)
  const [confirming, setConfirming] = useState(false)
  if (loadState !== 'ready') return null
  // The Parameters page has its own actions column; two Write buttons on one
  // screen would be two answers to the same question.
  if (tab === 'parameters') return null
  // ...but if edits are staged on another tab, keep the bar: quietly losing
  // sight of unsaved vehicle changes is the worse of the two outcomes.
  if (PARAMLESS_TABS.has(tab) && dirtyCount === 0) return null

  const write = () => {
    setConfirming(false)
    void connectionService.writeDirtyParams().then((result) => {
      useParamStore.getState().setLastWrite(result)
    })
  }

  return (
    <>
      {/* The confirmation lives here rather than on the Parameters tab
          because edits stage from anywhere -- a curated Setup card, the
          compare tool, the table -- and this button is what sends all of
          them. One list, wherever they came from. */}
      <WriteParamsModal open={confirming} onConfirm={write} onCancel={() => setConfirming(false)} />
      <LaButton
        variant="primary"
        size="lg"
        disabled={dirtyCount === 0 || writeBusy}
        onClick={() => setConfirming(true)}
      >
        {writeBusy ? 'Writing…' : `Write Params${dirtyCount > 0 ? ` (${dirtyCount})` : ''}`}
      </LaButton>
      <LaButton
        variant="ghost"
        disabled={writeBusy || dirtyCount === 0}
        onClick={() => useParamStore.getState().revertAll()}
      >
        Revert
      </LaButton>
      <LaButton
        variant="ghost"
        disabled={writeBusy}
        onClick={() => void connectionService.refreshParams()}
      >
        Refresh
      </LaButton>
    </>
  )
}

export default function ActionBar() {
  const [version, setVersion] = useState(__APP_VERSION__)
  const mode = useUiStore((s) => s.mode)
  const activeTab = useUiStore((s) => s.activeTab)

  useEffect(() => {
    // The packaged Electron app's version is authoritative (it can differ
    // from the bundled build's during development).
    window.loftgcs?.app.getVersion().then(setVersion)
  }, [])

  return (
    <footer className="la-actionbar">
      {/* Staged parameter edits are global, so Write lives in one place for
          every Setup tab rather than appearing and vanishing per screen. */}
      {mode === 'setup' && <ParamActions tab={activeTab} />}
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
