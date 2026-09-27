import { useEffect } from 'react'
import AppBar from './ui/shell/AppBar'
import NavRail from './ui/shell/NavRail'
import ActionBar from './ui/shell/ActionBar'
import ConnectModal from './ui/shell/ConnectModal'
import PreferencesModal from './ui/shell/PreferencesModal'
import SerialChooserModal from './ui/shell/SerialChooserModal'
import PreviewNotice from './ui/shell/PreviewNotice'
import UnsavedChangesModal from './ui/shell/UnsavedChangesModal'
import RebootPrompt from './ui/components/RebootPrompt'
import { holdsVehicleTabs, tabFills, useUiStore, visibleTabs } from './stores/ui-store'
import { useConnectionStore } from './stores/connection-store'
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
import FiltersTab from './ui/tabs/filters/FiltersTab'
import OsdTab from './ui/tabs/osd/OsdTab'
import ParamsTab from './ui/tabs/params/ParamsTab'
import LogsTab from './ui/tabs/logs/LogsTab'
import FilesTab from './ui/tabs/files/FilesTab'
import InspectorTab from './ui/tabs/inspector/InspectorTab'
import FlightTab from './ui/tabs/flight/FlightTab'
import MissionTab from './ui/tabs/mission/MissionTab'
import SimFieldPicker from './ui/shell/SimFieldPicker'
import { startReading } from './services/joystick'

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
    case 'filters':
      return <FiltersTab />
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

  // The gamepad is read for the whole session, not only while its pane is
  // open: control taken on the Fly screen stays taken on every other one.
  useEffect(() => {
    startReading()
  }, [])

  // Losing the link while on a vehicle-only tab drops to the first tab that
  // remains. No unsaved-changes prompt: the disconnect already cleared the
  // parameters those screens stage against.
  useEffect(() => {
    if (connected) return
    const offline = visibleTabs(false)
    if (offline.some((t) => t.id === activeTab)) return
    const first = offline[0]
    if (first) useUiStore.setState({ activeTab: first.id })
  }, [connected, activeTab])
  const showRail = mode === 'setup'
  // Fly and Mission always take the window; inside Setup, so do the tabs
  // that lay out their own full height rather than tiling cards.
  const flush = mode !== 'setup' || tabFills(activeTab)

  return (
    <div className="la-app">
      <AppBar />
      <main className={showRail ? 'la-main app-main' : 'la-main app-main app-main--full'}>
        {showRail && <NavRail />}
        <div className={flush ? 'app-content app-content--flush' : 'app-content'}>
          {mode === 'setup' && <SetupContent />}
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
      {/* The single restart dialog for every screen; see RebootPrompt. */}
      <RebootPrompt />
      {/* Last, so it sits over everything on first run. */}
      <PreviewNotice />
    </div>
  )
}
