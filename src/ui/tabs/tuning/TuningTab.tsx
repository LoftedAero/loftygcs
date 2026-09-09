import { useState } from 'react'
import ParamCard, { NeedsVehicle } from '../../components/ParamCard'
import ParamMatrix from '../../components/ParamMatrix'
import SetupDoc from '../../components/SetupDoc'
import SubTabs from '../../components/SubTabs'
import { useConnectionStore } from '../../../stores/connection-store'

// The tuning parameters people actually reach for, in the spirit of Mission
// Planner's extended tuning screen. Cards whose parameters this vehicle does
// not have hide themselves, so the same declaration serves Copter and Plane.
//
// Split in two because these are two sittings, not one long screen. Attitude
// is what you open when the aircraft oscillates; navigation is what you open
// when it flies the mission too fast or climbs too slowly. Nobody adjusts
// both in the same session, and the gains are the ones worth uncluttered.

const VIEWS = [
  { id: 'attitude', label: 'Attitude' },
  { id: 'navigation', label: 'Navigation' },
] as const

type View = (typeof VIEWS)[number]['id']

/** The columns every rate matrix shares -- one PID loop per axis. */
const RATE_COLUMNS = [
  { label: 'P' },
  { label: 'I' },
  { label: 'D' },
  { label: 'D filter', unit: 'Hz' },
]

export default function TuningTab() {
  const [view, setView] = useState<View>('attitude')
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')

  if (!connected) {
    return (
      <NeedsVehicle
        title="Tuning"
        body="The commonly adjusted rate and angle gains, navigation speeds, and autotune. The full set lives on the Parameters tab."
      />
    )
  }

  const tabs = <SubTabs tabs={VIEWS} active={view} onChange={setView} label="Tuning view" />

  if (view === 'navigation') {
    return (
      <>
        {tabs}
        <SetupDoc>
          <ParamCard
            title="Altitude and position"
            fields={[
              { param: 'PSC_ACCZ_P', label: 'Throttle accel P' },
              { param: 'PSC_ACCZ_I', label: 'Throttle accel I' },
              { param: 'PSC_POSZ_P', label: 'Altitude P' },
              { param: 'PSC_POSXY_P', label: 'Position P' },
            ]}
          />
          <ParamCard
            title="Speeds and limits"
            fields={[
              { param: 'WPNAV_SPEED', label: 'Waypoint speed', unit: 'cm/s' },
              { param: 'WPNAV_SPEED_UP', label: 'Climb speed', unit: 'cm/s' },
              { param: 'WPNAV_SPEED_DN', label: 'Descent speed', unit: 'cm/s' },
              { param: 'WPNAV_ACCEL', label: 'Waypoint accel', unit: 'cm/s/s' },
              { param: 'PILOT_SPEED_UP', label: 'Pilot climb speed', unit: 'cm/s' },
              { param: 'PILOT_SPEED_DN', label: 'Pilot descent speed', unit: 'cm/s' },
              { param: 'ANGLE_MAX', label: 'Lean angle max', unit: 'cdeg' },
            ]}
          />
        </SetupDoc>
      </>
    )
  }

  return (
    <>
      {tabs}
      <SetupDoc>
        {/* Only one of these two ever draws: the parameter names differ
          entirely between the multicopter attitude controller and the
          fixed-wing one, so the vehicle picks its own matrix. */}
        <ParamMatrix
          title="Rate gains"
          subtitle="Copter"
          columns={RATE_COLUMNS}
          rows={[
            {
              label: 'Roll',
              params: ['ATC_RAT_RLL_P', 'ATC_RAT_RLL_I', 'ATC_RAT_RLL_D', 'ATC_RAT_RLL_FLTD'],
            },
            {
              label: 'Pitch',
              params: ['ATC_RAT_PIT_P', 'ATC_RAT_PIT_I', 'ATC_RAT_PIT_D', 'ATC_RAT_PIT_FLTD'],
            },
            {
              label: 'Yaw',
              params: ['ATC_RAT_YAW_P', 'ATC_RAT_YAW_I', 'ATC_RAT_YAW_D', 'ATC_RAT_YAW_FLTD'],
            },
          ]}
        />
        <ParamMatrix
          title="Rate gains"
          subtitle="Plane"
          columns={RATE_COLUMNS}
          rows={[
            { label: 'Roll', params: ['RLL_RATE_P', 'RLL_RATE_I', 'RLL_RATE_D', 'RLL_RATE_FLTD'] },
            {
              label: 'Pitch',
              params: ['PTCH_RATE_P', 'PTCH_RATE_I', 'PTCH_RATE_D', 'PTCH_RATE_FLTD'],
            },
            { label: 'Yaw', params: ['YAW_RATE_P', 'YAW_RATE_I', 'YAW_RATE_D', 'YAW_RATE_FLTD'] },
          ]}
        />
        <ParamMatrix
          title="Angle gains"
          subtitle="Copter"
          columns={[{ label: 'Angle P' }, { label: 'Accel max', unit: 'cdeg/s/s' }]}
          rows={[
            { label: 'Roll', params: ['ATC_ANG_RLL_P', 'ATC_ACCEL_R_MAX'] },
            { label: 'Pitch', params: ['ATC_ANG_PIT_P', 'ATC_ACCEL_P_MAX'] },
            { label: 'Yaw', params: ['ATC_ANG_YAW_P', 'ATC_ACCEL_Y_MAX'] },
          ]}
        />
        <ParamCard
          title="Autotune"
          note="Autotune flies the vehicle to find its own gains. Read the ArduPilot procedure before switching into it — it needs space and calm air."
          fields={[
            { param: 'AUTOTUNE_AXES', label: 'Axes to tune' },
            { param: 'AUTOTUNE_AGGR', label: 'Aggressiveness' },
            { param: 'AUTOTUNE_MIN_D', label: 'Minimum D' },
          ]}
        />
      </SetupDoc>
    </>
  )
}
