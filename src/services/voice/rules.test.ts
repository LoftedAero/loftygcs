import { describe, expect, it } from 'vitest'
import { useVehicleStore, type VehicleSnapshot } from '../../stores/vehicle-store'
import { DEFAULT_UNITS } from '../../units'
import { calloutDef, type CalloutId } from './catalog'
import { CalloutWatcher, SETTLE_MS, type WatchConfig } from './rules'

const PREARM = 1 << 28
const GEOFENCE = 1 << 20

const base: VehicleSnapshot = {
  ...useVehicleStore.getState(),
  present: true,
  vehicleType: 2, // quadrotor
  modeName: 'Stabilize',
  sensorsPresent: PREARM,
  sensorsEnabled: PREARM,
  gpsFix: 3,
  batteryPct: 80,
  batteryV: 16.4,
}

function config(overrides: Partial<Record<CalloutId, number>> = {}, repeatS = 30): WatchConfig {
  return {
    units: DEFAULT_UNITS,
    value: (id) => overrides[id] ?? calloutDef(id).threshold?.default ?? 0,
    repeatS,
  }
}

/**
 * The rules compute every row; the announcer drops the ones set to off. The
 * periodic rows speak on a clock, so `say` leaves them to their own tests.
 */
const PERIODIC = new Set<CalloutId>(['readout', 'timer'])

/** A watcher connected and looking at `first`, with a clock to step. */
function watch(first: Partial<VehicleSnapshot> = {}, cfg = config()) {
  const w = new CalloutWatcher()
  let now = 1000
  let v: VehicleSnapshot = { ...base, ...first }
  const step = (patch: Partial<VehicleSnapshot> = {}, ms = 250, phase = 'connected') => {
    now += ms
    v = { ...v, ...patch }
    return w.update({ phase, v, traffic: [] }, now, cfg)
  }
  step({}, 0)
  step({}, SETTLE_MS)
  return {
    w,
    step,
    say: (patch: Partial<VehicleSnapshot> = {}, ms = 250) =>
      step(patch, ms)
        .filter((e) => !PERIODIC.has(e.id))
        .map((e) => e.text),
    message: (text: string, severity = 6) =>
      w.message({ text, severity, at: now }, now).map((e) => e.id),
    now: () => now,
  }
}

describe('flight state callouts', () => {
  it('says nothing about the state it finds on connecting', () => {
    const w = new CalloutWatcher()
    const v = { ...base, armed: true, modeName: 'Loiter' }
    expect(w.update({ phase: 'connected', v, traffic: [] }, 0, config())).toEqual([])
    expect(w.update({ phase: 'connected', v, traffic: [] }, 250, config())).toEqual([])
  })

  it('takes the first seconds after connecting as found, before every message has arrived', () => {
    const w = new CalloutWatcher()
    const at = (ms: number, patch: Partial<VehicleSnapshot>) =>
      w.update({ phase: 'connected', v: { ...base, ...patch }, traffic: [] }, ms, config())
    // The heartbeat first, the GPS a moment later.
    expect(at(0, { gpsFix: 0 })).toEqual([])
    expect(at(400, { gpsFix: 6 })).toEqual([])
    expect(at(SETTLE_MS + 500, { gpsFix: 6 })).toEqual([])
  })

  it('says a mode once it has held for half a second', () => {
    const t = watch()
    expect(t.say({ modeName: 'Loiter' })).toEqual([])
    expect(t.say({ modeName: 'RTL' })).toEqual([])
    expect(t.say({}, 250)).toEqual([])
    expect(t.say({}, 300)).toEqual(['Return to launch mode'])
    expect(t.say({}, 1000)).toEqual([])
  })

  it('says nothing for a mode flicked away and back', () => {
    const t = watch()
    expect(t.say({ modeName: 'Loiter' }, 100)).toEqual([])
    expect(t.say({ modeName: 'Stabilize' }, 100)).toEqual([])
    expect(t.say({}, 1000)).toEqual([])
  })

  it('says armed and disarmed, and the fence when arming with one enabled', () => {
    const t = watch({ sensorsEnabled: PREARM | GEOFENCE })
    expect(t.say({ armed: true })).toEqual(['Armed', 'Fence enabled'])
    expect(t.say({ armed: false })).toEqual(['Disarmed'])
  })

  it('says ready to arm after the checks have passed for three seconds', () => {
    const t = watch()
    expect(t.say({ sensorsHealth: PREARM })).toEqual([])
    expect(t.say({}, 2000)).toEqual([])
    expect(t.say({}, 1000)).toEqual(['Ready to arm'])
    expect(t.say({}, 5000)).toEqual([])
  })

  it('says landing complete when the vehicle reports landing', () => {
    const t = watch({ armed: true, landedState: 2 })
    expect(t.say({ landedState: 1 })).toEqual(['Landing complete'])
  })
})

describe('link callouts', () => {
  it('says telemetry lost and regained', () => {
    const t = watch()
    expect(t.step({}, 250, 'linkLost').map((e) => e.text)).toEqual(['Telemetry lost'])
    expect(t.step({}, 250, 'connected').map((e) => e.text)).toEqual(['Telemetry regained'])
  })

  it('says nothing for a disconnect the user asked for', () => {
    const t = watch()
    expect(t.step({}, 250, 'idle')).toEqual([])
  })
})

describe('battery callouts', () => {
  const pack = (chargeState: number) => ({
    batteries: { 0: { voltageV: 15, currentA: 10, remainingPct: 40, chargeState } },
  })

  it('says a battery state only when it gets worse', () => {
    const t = watch({ armed: true, ...pack(1) })
    expect(t.say(pack(2))).toEqual(['Battery low'])
    expect(t.say(pack(2), 1000)).toEqual([])
    expect(t.say(pack(3))).toEqual(['Battery critical'])
    expect(t.say(pack(2))).toEqual([])
  })

  it('says it again after the battery has recovered and dropped again', () => {
    const t = watch({ armed: true, ...pack(2) })
    t.say(pack(1))
    expect(t.say(pack(2))).toEqual(['Battery low'])
  })

  it('leaves the vehicle’s battery message to the battery state when it has one', () => {
    const t = watch({ armed: true, ...pack(1) })
    expect(t.message('Battery 1 is low 14.0V used 2200 mAh', 2)).toEqual([])
  })

  it('speaks the battery message when the vehicle sends no battery state', () => {
    const t = watch()
    expect(t.message('Battery 1 is critical 13.2V used 2900 mAh', 2)).toEqual(['batt-crit'])
  })

  it('counts percentage steps down, never up, from the first reading', () => {
    const t = watch({ batteryPct: 47 })
    expect(t.say({ batteryPct: 45 })).toEqual([])
    expect(t.say({ batteryPct: 40 })).toEqual(['Battery 40 percent'])
    expect(t.say({ batteryPct: 41 })).toEqual([])
    expect(t.say({ batteryPct: 40 })).toEqual([])
    expect(t.say({ batteryPct: 18 })).toEqual(['Battery 20 percent'])
  })
})

describe('messages from the aircraft', () => {
  it('sorts messages into their rows, and by severity otherwise', () => {
    const t = watch()
    expect(t.message('EKF variance', 2)).toEqual(['ekf'])
    expect(t.message('Radio Failsafe - Continuing Auto Mode', 4)).toEqual(['failsafe'])
    expect(t.message('GPS Glitch', 2)).toEqual(['gps-glitch'])
    expect(t.message('Mission complete, changing mode to RTL', 6)).toEqual(['mission-done'])
    expect(t.message('Land final started', 6)).toEqual(['land-stages'])
    expect(t.message('Takeoff complete at 20.06m', 6)).toEqual(['takeoff-done'])
    expect(t.message('Transition done', 6)).toEqual(['transition'])
    expect(t.message('AutoTune: Success', 6)).toEqual(['autotune'])
    expect(t.message('Mode change to Guided failed: requires position', 4)).toEqual([
      'mode-refused',
    ])
    expect(t.message('#Payload released', 6)).toEqual(['hash'])
    expect(t.message('Crash: Disarming', 2)).toEqual(['sev-crit'])
    expect(t.message('Compass not calibrated', 3)).toEqual(['sev-err'])
    expect(t.message('Throttle armed', 4)).toEqual(['sev-warn'])
    expect(t.message('ArduCopter V4.7.1', 6)).toEqual(['sev-notice'])
  })

  it('says the same text at most once in ten seconds', () => {
    const t = watch()
    expect(t.message('Crash: Disarming', 2)).toEqual(['sev-crit'])
    t.step({}, 5000)
    expect(t.message('Crash: Disarming', 2)).toEqual([])
    t.step({}, 6000)
    expect(t.message('Crash: Disarming', 2)).toEqual(['sev-crit'])
  })

  it('keeps PreArm repeats to their own row and never to another', () => {
    const t = watch()
    expect(t.message('PreArm: Need 3D Fix', 2)).toEqual(['prearm'])
    expect(t.message('Arm: Throttle too high', 2)).toEqual([])
  })

  it('says a refused arm with the reason the vehicle gave', () => {
    const t = watch()
    t.message('Arm: Need Position Estimate', 2)
    expect(t.w.event({ t: 'arm-refused' }, t.now()).map((e) => e.text)).toEqual([
      'Arming refused. Need Position Estimate',
    ])
  })

  it('does not say a refused mode twice when the vehicle has said it', () => {
    const t = watch()
    t.message('Mode change to Auto failed: no mission', 4)
    expect(t.w.event({ t: 'mode-refused' }, t.now() + 4000)).toEqual([])
    expect(t.w.event({ t: 'mode-refused' }, t.now() + 20000)).toHaveLength(1)
  })
})

describe('alerts that repeat', () => {
  it('repeats a failsafe while flying, at the chosen interval', () => {
    const t = watch({ armed: true, landedState: 2 }, config({}, 10))
    t.message('Radio Failsafe - Returning to launch', 2)
    expect(t.say({ systemStatus: 5 })).toEqual([])
    expect(t.say({}, 9000)).toEqual([])
    expect(t.say({}, 1000)).toEqual(['Radio Failsafe, Returning to launch'])
    expect(t.say({ systemStatus: 4 }, 20000)).toEqual([])
  })

  it('says a failsafe state that came with no message', () => {
    const t = watch({ armed: true, landedState: 2 })
    expect(t.say({ systemStatus: 5 })).toEqual(['Failsafe'])
  })

  it('never repeats when repeats are off', () => {
    const t = watch({ armed: true, landedState: 2 }, config({}, 0))
    expect(t.say({ fence: { breached: true, breachType: 2 } })).toEqual([
      'Fence breached, maximum altitude',
    ])
    expect(t.say({}, 120000)).toEqual([])
  })

  it('arms the low-altitude alert only after climbing past it', () => {
    const t = watch({ armed: true, landedState: 2, relAltM: 3 })
    expect(t.say({ relAltM: 4 })).toEqual([])
    t.say({ relAltM: 30 })
    expect(t.say({ relAltM: 8 })).toEqual(['Low altitude, 8 meters'])
  })
})

describe('periodic callouts', () => {
  it('reads out height, distance and speed at the interval while flying', () => {
    const home = { latDeg: 0, lonDeg: 0, altMslM: 0 }
    const t = watch({ armed: true, landedState: 2, home, latDeg: 0.0045, relAltM: 85 })
    const readouts = () => t.step({}, 10000).filter((e) => e.id === 'readout')
    expect(readouts()).toEqual([])
    expect(readouts()).toEqual([])
    expect(readouts().map((e) => e.text)).toEqual([
      'Altitude 85 meters. Distance 500 meters. Speed 0 meters per second',
    ])
  })

  it('counts flight time in whole intervals from arming', () => {
    const t = watch({}, config({ timer: 1 }))
    t.step({ armed: true })
    const timer = (ms: number) =>
      t
        .step({}, ms)
        .filter((e) => e.id === 'timer')
        .map((e) => e.text)
    expect(timer(59000)).toEqual([])
    expect(timer(1000)).toEqual(['1 minute'])
    expect(timer(60000)).toEqual(['2 minutes'])
  })
})

describe('GPS and mission callouts', () => {
  it('says a fix gained, and a fix lost once while armed', () => {
    const t = watch({ gpsFix: 1 })
    expect(t.say({ gpsFix: 3 })).toEqual(['GPS 3D fix'])
    t.say({ armed: true })
    expect(t.say({ gpsFix: 2 })).toEqual(['GPS fix lost'])
    expect(t.say({ gpsFix: 1 })).toEqual([])
  })

  it('says each new waypoint in Auto', () => {
    const t = watch({ armed: true, modeName: 'Auto', missionSeq: 1 })
    expect(t.say({ missionSeq: 2 })).toEqual(['Waypoint 2'])
    expect(t.say({ modeName: 'Loiter', missionSeq: 3 })).toEqual([])
  })
})
