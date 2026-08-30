// Profile registry and resolution. Products extend classes; labels merge
// product-over-class; guides browse as "product guides" plus the connected
// vehicle class's generic guides.
import type { GuideDef, ProfileDef } from './types'
import { CLASS_PROFILES } from './generic'
import { LOFTED_F35B } from './lofted-f35b'

const ALL: ProfileDef[] = [...CLASS_PROFILES, LOFTED_F35B]
const BY_ID = new Map(ALL.map((p) => [p.id, p]))

export function profileById(id: string): ProfileDef | undefined {
  return BY_ID.get(id)
}

export function productProfiles(): ProfileDef[] {
  return ALL.filter((p) => p.layer === 'product')
}

/** Product-first chain: [product, its class, ...]. */
export function resolveChain(id: string): ProfileDef[] {
  const chain: ProfileDef[] = []
  let current = BY_ID.get(id)
  while (current) {
    chain.push(current)
    current = current.extends ? BY_ID.get(current.extends) : undefined
  }
  return chain
}

/** Class guides applicable to a live vehicle type (generic content). */
export function classGuidesFor(vehicleType: number): { profile: ProfileDef; guide: GuideDef }[] {
  return CLASS_PROFILES.filter((p) => p.matchVehicleTypes?.includes(vehicleType)).flatMap((p) =>
    p.guides.map((guide) => ({ profile: p, guide })),
  )
}

/** Merged label maps for a selected profile chain; product wins. */
export function mergedLabels(id: string): {
  outputLabels: Record<number, string>
  channelLabels: Record<number, string>
} {
  const outputLabels: Record<number, string> = {}
  const channelLabels: Record<number, string> = {}
  // Walk class-first so product entries overwrite.
  for (const p of resolveChain(id).reverse()) {
    Object.assign(outputLabels, p.outputLabels)
    Object.assign(channelLabels, p.channelLabels)
  }
  return { outputLabels, channelLabels }
}

export function findGuide(
  profileId: string,
  guideId: string,
): { profile: ProfileDef; guide: GuideDef } | null {
  for (const profile of resolveChain(profileId)) {
    const guide = profile.guides.find((g) => g.id === guideId)
    if (guide) return { profile, guide }
  }
  return null
}
