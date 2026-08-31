import AppBar from './ui/shell/AppBar'
import NavRail from './ui/shell/NavRail'
import ActionBar from './ui/shell/ActionBar'
import ConnectModal from './ui/shell/ConnectModal'
import SerialChooserModal from './ui/shell/SerialChooserModal'
import PreviewNotice from './ui/shell/PreviewNotice'
import { useUiStore } from './stores/ui-store'
import { useGuideStore } from './stores/guide-store'
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
import FlightTab from './ui/tabs/flight/FlightTab'
import MissionTab from './ui/tabs/mission/MissionTab'
import SimulatorTab from './ui/tabs/simulator/SimulatorTab'

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
  }
}

export default function App() {
  const mode = useUiStore((s) => s.mode)
  const guideActive = useGuideStore((s) => s.activeGuide !== null)
  // A running guide replaces the rail as well as the content: it is a
  // sequence to follow, and half-leaving it mid-step loses the thread.
  const showRail = mode === 'setup' && !guideActive

  return (
    <div className="la-app">
      <AppBar />
      <main className={showRail ? 'la-main app-main' : 'la-main app-main app-main--full'}>
        {showRail && <NavRail />}
        <div className={mode === 'setup' ? 'app-content' : 'app-content app-content--flush'}>
          {mode === 'setup' && (guideActive ? <GuideRunner /> : <SetupContent />)}
          {mode === 'fly' && <FlightTab />}
          {mode === 'mission' && <MissionTab />}
          {mode === 'simulator' && <SimulatorTab />}
        </div>
      </main>
      <ActionBar />
      <ConnectModal />
      <SerialChooserModal />
      {/* Last, so it sits over everything on first run. */}
      <PreviewNotice />
    </div>
  )
}
