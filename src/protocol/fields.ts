// Every numeric field of every message the vehicle sends, flattened to
// `MESSAGE.field` names.
//
// Generic on purpose, so the status list and plots show whatever the vehicle
// sends rather than a curated list.

import type { DecodedMessage } from './types'

/**
 * Addressing fields, identical on every packet of a link. The packet
 * sequence number lives on the frame and never reaches here; a message field
 * named `seq` (a mission item index) is meaningful and kept.
 */
const IGNORED = new Set(['targetSystem', 'targetComponent'])

/** Qualified so `ATTITUDE.roll` and `AHRS2.roll` stay distinguishable. */
export function fieldName(msgName: string, field: string): string {
  return `${msgName}.${field}`
}

/**
 * Fold a decoded message's numeric fields into the running set. Strings,
 * arrays and bigints are skipped rather than coerced to NaN.
 */
export function collectFields(msg: DecodedMessage, into: Map<string, number>): void {
  for (const [key, value] of Object.entries(msg.fields)) {
    if (IGNORED.has(key)) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    into.set(fieldName(msg.msgName, key), value)
  }
}
