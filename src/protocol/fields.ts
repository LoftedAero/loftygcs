// Every numeric field of every message the vehicle sends, flattened to
// `MESSAGE.field` names.
//
// Generic on purpose: the status list and the plots should show whatever the
// vehicle happens to be sending, not a list somebody curated and then forgot
// to extend when a new message arrived. That is the difference between a
// diagnostic tool that stays useful and one that quietly goes stale.

import type { DecodedMessage } from './types'

/**
 * Fields that carry no information worth watching.
 *
 * Only the addressing ones: they are identical on every packet of a link, so
 * listing them buries the fields that matter under ones that never say
 * anything. The packet sequence number is not here because it never reaches
 * this function -- it lives on the frame, not among a message's fields, and
 * a field genuinely called `seq` (a mission item's index, say) does mean
 * something.
 */
const IGNORED = new Set(['targetSystem', 'targetComponent'])

/** Qualified so `ATTITUDE.roll` and `AHRS2.roll` stay distinguishable. */
export function fieldName(msgName: string, field: string): string {
  return `${msgName}.${field}`
}

/**
 * Fold a decoded message's numeric fields into the running set.
 *
 * Non-numeric fields (strings, arrays, bigints) are skipped rather than
 * coerced: a status text or a covariance matrix is not something to plot,
 * and Number(array) would quietly produce NaN entries that then have to be
 * filtered out at every read.
 */
export function collectFields(msg: DecodedMessage, into: Map<string, number>): void {
  for (const [key, value] of Object.entries(msg.fields)) {
    if (IGNORED.has(key)) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    into.set(fieldName(msg.msgName, key), value)
  }
}
