import { useEffect } from 'react'
import AppBar from './ui/shell/AppBar'
import NavRail from './ui/shell/NavRail'
import ActionBar from './ui/shell/ActionBar'
import ConnectModal from './ui/shell/ConnectModal'
import PreferencesModal from './ui/shell/PreferencesModal'
import SerialChooserModal from './ui/shell/SerialChooserModal'
import PreviewNotice from './ui/shell/PreviewNotice'
import UnsavedChangesModal from './ui/shell/UnsavedChangesModal'
import { holdsVehicleTabs, tabFills, useUiStore, visibleTabs } from './stores/ui-store'
import { useGuideStore } from './stores/guide-store'
import { useConnectionStore } from './stores/connection-store'
import GuideRunner from './ui/guides/GuideRunner'
import OverviewTab from './ui/tabs/overview/OverviewTab'
import FirmwareTab from './ui/tabs/firmware/FirmwareTab'
import ConfigurationTab from './ui/tabs/configuration/ConfigurationTab'
import PortsTab from './ui/tabs/ports/PortsTab'
import SensorsTab from './ui/tabs/sensors/SensorsTab'
import RadioTab from './ui/tabs/radio/RadioTab'
import FlightModesTab from './ui/tabs/modes/FlightModesTab'
import OutputsTab from './ui/tabs/outputs/OutputsTab'
import PowerTab from './ui/tabs/power/PowerTab'
import FailsafesTab from './ui/tabs/failsafes/FailsafesTab'
import TuningTab from './ui/tabs/tuning/TuningTab'
import OsdTab from './ui/tabs/osd/OsdTab'
import ParamsTab from './ui/tabs/params/ParamsTab'
import LogsTab from './ui/tabs/logs/LogsTab'
import FilesTab from './ui/tabs/files/FilesTab'
import InspectorTab from './ui/tabs/inspector/InspectorTab'
import FlightTab from './ui/tabs/flight/FlightTab'
import MissionTab from './ui/tabs/mission/MissionTab'
import SimFieldPicker from './ui/shell/SimFieldPicker'

function SetupContent() {
  const activeTab = useUiStore((s) => s.activeTab)
  switch (activeTab) {
    case 'overview':
      return <OverviewTab />
    case 'firmware':
      return <FirmwareTab />
    case 'configuration':
      return <ConfigurationTab />
    case 'ports':
      return <PortsTab />
    case 'sensors':
      return <SensorsTab />
    case 'radio':
      return <RadioTab />
    case 'modes':
      return <FlightModesTab />
    case 'outputs':
      return <OutputsTab />
    case 'power':
      return <PowerTab />
    case 'failsafes':
      return <FailsafesTab />
    case 'tuning':
      return <TuningTab />
    case 'osd':
      return <OsdTab />
    case 'parameters':
      return <ParamsTab />
    case 'logs':
      return <LogsTab />
    case 'files':
      return <FilesTab />
    case 'inspector':
      return <InspectorTab />
  }
}

export default function App() {
  const mode = useUiStore((s) => s.mode)
  const activeTab = useUiStore((s) => s.activeTab)
  const connected = useConnectionStore((s) => holdsVehicleTabs(s.phase))

  // A tab that leaves the rail must not leave someone staring at it. Losing
  // the link while on, say, Radio drops you to the top of what is left --
  // Betaflight does the same, returning to its Welcome tab. The destination
  // is read from the list rather than named here, so changing which tabs
  // survive a disconnect needs nothing of this file. Nothing is prompted
  // about on the way: the parameters those screens stage against are cleared
  // by the disconnect, so there is nothing left to lose.
  useEffect(() => {
    if (connected) return
    const offline = visibleTabs(false)
    if (offline.some((t) => t.id === activeTab)) return
    const first = offline[0]
    if (first) useUiStore.setState({ activeTab: first.id })
  }, [connected, activeTab])
  const guideActive = useGuideStore((s) => s.activeGuide !== null)
  // A running guide replaces the rail as well as the content: it is a
  // sequence to follow, and half-leaving it mid-step loses the thread.
  const showRail = mode === 'setup' && !guideActive
  // Fly and Mission always take the window; inside Setup, so do the tabs
  // that lay out their own full height rather than tiling cards.
  const flush = mode !== 'setup' || (!guideActive && tabFills(activeTab))

  return (
    <div className="la-app">
      <AppBar />
      <main className={showRail ? 'la-main app-main' : 'la-main app-main app-main--full'}>
        {showRail && <NavRail />}
        <div className={flush ? 'app-content app-content--flush' : 'app-content'}>
          {mode === 'setup' && (guideActive ? <GuideRunner /> : <SetupContent />)}
          {mode === 'fly' && <FlightTab />}
          {mode === 'mission' && <MissionTab />}
        </div>
      </main>
      <ActionBar />
      <ConnectModal />
      <SimFieldPicker />
      <PreferencesModal />
      <SerialChooserModal />
      <UnsavedChangesModal />
      {/* Last, so it sits over everything on first run. */}
      <PreviewNotice />
    </div>
  )
}
