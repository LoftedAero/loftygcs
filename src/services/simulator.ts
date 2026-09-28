// Driving the locally managed SITL: install it, start it, and attach the
// app's normal TCP link to it. This is real ArduPilot
// firmware, with its real parameters, arming checks and mode logic.
import { connectionService } from './connection'
import { useSimStore } from '../stores/sim-store'
import type { SimLaunch } from '../types/loftgcs'

const SIM_HOST = '127.0.0.1'

export function simulatorAvailable(): boolean {
  return typeof window !== 'undefined' && window.loftgcs !== undefined
}

export async function refreshSimStatus(): Promise<void> {
  const bridge = window.loftgcs
  if (!bridge) return
  useSimStore.getState().setStatus(await bridge.sim.status())
}

export async function installSimulator(vehicle: string): Promise<void> {
  const bridge = window.loftgcs
  if (!bridge) return
  const store = useSimStore.getState()
  store.setPhase('installing')
  try {
    await bridge.sim.install(vehicle)
    await refreshSimStatus()
    store.setPhase('idle')
  } catch (err) {
    store.fail(err instanceof Error ? err.message : 'install failed')
  } finally {
    useSimStore.getState().setProgress(null)
  }
}

export async function startSimulator(launch: SimLaunch): Promise<void> {
  const bridge = window.loftgcs
  if (!bridge) return
  const store = useSimStore.getState()
  store.setPhase('starting')
  try {
    const { port, waitingForRealFlight } = await bridge.sim.start(launch)
    await refreshSimStatus()
    useSimStore.getState().setPhase('running')
    if (waitingForRealFlight) {
      // SITL sends nothing until RealFlight is exchanging data, so connecting
      // now would time out. The simulator keeps retrying RealFlight; connect
      // once it is up.
      useSimStore.getState().setWaitingForRealFlight(true)
      return
    }
    await connectionService.connect({ kind: 'tcp', host: SIM_HOST, port })
  } catch (err) {
    useSimStore.getState().fail(err instanceof Error ? err.message : 'simulator failed to start')
    await bridge.sim.stop().catch(() => {})
    await refreshSimStatus()
  }
}

export async function stopSimulator(): Promise<void> {
  const bridge = window.loftgcs
  if (!bridge) return
  // Disconnect first: SITL exits when its TCP client drops, and this order
  // reports a clean disconnect rather than a link failure.
  await connectionService.disconnect()
  await bridge.sim.stop()
  await refreshSimStatus()
  useSimStore.getState().setPhase('idle')
}

/** Attach to a simulator the user is running themselves (any platform). */
export async function connectExternalSimulator(port = 5760): Promise<void> {
  await connectionService.connect({ kind: 'tcp', host: SIM_HOST, port })
}

/** Wire the main-process event streams into the store. Call once. */
export function subscribeSimEvents(): () => void {
  const bridge = window.loftgcs
  if (!bridge) return () => {}
  const store = useSimStore.getState()
  const unsubs = [
    bridge.sim.onProgress((p) => useSimStore.getState().setProgress(p)),
    bridge.sim.onLog((line) => useSimStore.getState().appendLog(line)),
    bridge.sim.onExit(() => {
      useSimStore.getState().setPhase('idle')
      void refreshSimStatus()
    }),
  ]
  void refreshSimStatus()
  store.setPhase('idle')
  return () => unsubs.forEach((u) => u())
}
