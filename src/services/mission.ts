// Mission read, write, open and save. Open and save use an input element and
// a blob download rather than a native dialog, so the same code runs in the
// browser and in Electron without widening the preload surface.

import { connectionService } from './connection'
import { useMissionStore } from '../stores/mission-store'
import { planFromItems, planToItems } from '../protocol/mission-plan'
import {
  parsePlanFile,
  parseWaypointsFile,
  serializeWaypointsFile,
} from '../protocol/mission-file'
import { useVehicleStore } from '../stores/vehicle-store'

/** Read the vehicle's mission into the editor, replacing what is there. */
export async function readFromVehicle(): Promise<void> {
  const store = useMissionStore.getState()
  store.setTransfer({ kind: 'busy', dir: 'read', got: 0, total: 0 })
  try {
    const items = await connectionService.downloadMission(0)
    const plan = planFromItems(items)
    store.setPlan(plan, { synced: true, name: 'Vehicle' })
    store.setTransfer({
      kind: 'done',
      text: plan.items.length ? `Read ${plan.items.length} items` : 'Vehicle has no mission',
    })
  } catch (err) {
    store.setTransfer({ kind: 'error', text: message(err) })
    throw err
  }
}

/**
 * Send the plan to the vehicle. The plan is marked synced only once the
 * vehicle acks it as accepted; a failed transfer leaves the previous mission.
 */
export async function writeToVehicle(): Promise<void> {
  const store = useMissionStore.getState()
  const plan = store.plan
  store.setTransfer({ kind: 'busy', dir: 'write', got: 0, total: plan.items.length + 1 })
  try {
    await connectionService.uploadMission(planToItems(plan), 0)
    useMissionStore.getState().markSynced()
    store.setTransfer({ kind: 'done', text: `Wrote ${plan.items.length} items` })
  } catch (err) {
    store.setTransfer({ kind: 'error', text: message(err) })
    throw err
  }
}

/** Prompt for a file and load it. Resolves when the plan has been replaced. */
export function openFromFile(): Promise<void> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.waypoints,.txt,.plan,.mission'
    // Attached to the document: some browsers ignore a click on a detached input.
    input.style.display = 'none'
    document.body.appendChild(input)
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      input.remove()
      resolve()
    }
    // Dismissing the picker fires cancel, not change; without this the
    // promise would never settle.
    input.oncancel = done
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return done()
      const store = useMissionStore.getState()
      try {
        const text = await file.text()
        const plan = /\.plan$/i.test(file.name) ? fromPlan(text) : fromWaypoints(text)
        // Loading does not mark the plan synced; the vehicle still holds its own.
        store.setPlan(plan, { name: file.name })
        store.setTransfer({ kind: 'done', text: `Loaded ${plan.items.length} items` })
      } catch (err) {
        store.setTransfer({ kind: 'error', text: message(err) })
      }
      done()
    }
    input.click()
  })
}

function fromWaypoints(text: string) {
  return planFromItems(parseWaypointsFile(text))
}

function fromPlan(text: string) {
  const { items, home } = parsePlanFile(text)
  // A .plan keeps home outside the item list; the wire form wants it first.
  const withHome = [
    {
      seq: 0,
      frame: 0,
      command: 16,
      current: 1,
      autocontinue: 1,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: 0,
      x: home?.x ?? 0,
      y: home?.y ?? 0,
      z: home?.z ?? 0,
    },
    ...items,
  ]
  return planFromItems(withHome)
}

/** Save the plan as a .waypoints file. */
export function saveToFile(name = 'mission.waypoints'): void {
  const text = serializeWaypointsFile(planToItems(useMissionStore.getState().plan))
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // Revoked on the next tick: revoking synchronously can beat the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  useMissionStore.getState().setTransfer({ kind: 'done', text: `Saved ${name}` })
}

/**
 * Put planned home at the vehicle's current position. Returns false without
 * a fix, rather than placing home at 0,0.
 */
export function homeFromVehicle(): boolean {
  const v = useVehicleStore.getState()
  if (v.latDeg === 0 && v.lonDeg === 0) return false
  useMissionStore.getState().setHome({
    x: Math.round(v.latDeg * 1e7),
    y: Math.round(v.lonDeg * 1e7),
    z: Math.round(v.altMslM),
  })
  return true
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
