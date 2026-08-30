// Vehicle profiles and guided setups.
//
// A profile is layered knowledge about an aircraft:
//   class layer   -- "a quadplane", "a multirotor": generic guides and checks
//   product layer -- "the Lofted Aero F-35B": a KNOWN configuration -- exact
//                    output map, known-good parameter baseline, bespoke
//                    bring-up sequence. Extends a class profile.
// Product profiles are content, not code: a directory-per-aircraft data
// module that a PR can add. Nothing here renders by default -- profiles only
// take effect when the user explicitly picks one (Setup > Guided setups).

export interface ParamValue {
  name: string
  value: number
}

export type GuideCheck =
  | { label: string; type: 'gpsFix3d' }
  | { label: string; type: 'rcSeen' }
  | { label: string; type: 'disarmed' }
  | { label: string; type: 'param'; param: string; value: number; tolerance?: number }

export type GuideStep =
  | { kind: 'info'; title: string; body: string }
  // A physical action the app cannot verify; the user attests to it.
  | { kind: 'manual'; title: string; body: string; confirmLabel: string }
  // Stage-and-write a bundle of parameters, each verified against its echo.
  | { kind: 'paramSet'; title: string; body?: string; params: ParamValue[] }
  // One MAV_CMD; done when the vehicle acks ACCEPTED.
  | {
      kind: 'command'
      title: string
      body?: string
      command: number
      params?: number[]
      timeoutMs?: number
      actionLabel: string
    }
  // Reuses the app's calibration flows.
  | { kind: 'calibration'; title: string; body?: string; cal: 'accel' | 'compass' | 'level' }
  // Live conditions evaluated continuously; done when all pass.
  | { kind: 'check'; title: string; body?: string; checks: GuideCheck[] }

export interface GuideDef {
  id: string
  title: string
  summary: string
  steps: GuideStep[]
}

export interface ProfileDef {
  id: string
  name: string
  layer: 'class' | 'product'
  /** Class profile this product builds on. */
  extends?: string
  maker?: string
  description?: string
  /** HEARTBEAT MAV_TYPEs this profile applies to (class layer). */
  matchVehicleTypes?: number[]
  /** SERVOn -> human name ("Nozzle tilt"), shown once the profile is selected. */
  outputLabels?: Record<number, string>
  /** RC channel -> human name ("Transition switch"). */
  channelLabels?: Record<number, string>
  /** Known-good parameter baseline for "diff against spec". */
  paramBaseline?: ParamValue[]
  guides: GuideDef[]
}
