import { describe, expect, it } from 'vitest'
import { classGuidesFor, findGuide, mergedLabels, productProfiles, resolveChain } from './index'

describe('profile registry', () => {
  it('resolves a product chain product-first', () => {
    const chain = resolveChain('lofted-f35b')
    expect(chain.map((p) => p.id)).toEqual(['lofted-f35b', 'class-quadplane'])
  })

  it('merges labels with the product layer winning', () => {
    const { outputLabels, channelLabels } = mergedLabels('lofted-f35b')
    expect(outputLabels[3]).toMatch(/3BSM/)
    expect(channelLabels[7]).toMatch(/Transition/)
  })

  it('finds a guide anywhere in the chain', () => {
    const found = findGuide('lofted-f35b', 'f35b-bringup')
    expect(found?.profile.id).toBe('lofted-f35b')
    expect(found?.guide.steps.length).toBeGreaterThan(5)
  })

  it('lists class guides by vehicle type, not products', () => {
    const copterGuides = classGuidesFor(2) // quadrotor
    expect(copterGuides.some(({ guide }) => guide.id === 'copter-first-setup')).toBe(true)
    // Products never auto-attach: a random Copter is not an F-35B.
    expect(copterGuides.every(({ profile }) => profile.layer === 'class')).toBe(true)
  })

  it('every guide step is a known kind with the fields its renderer needs', () => {
    for (const p of [...productProfiles(), ...classGuidesFor(2).map((g) => g.profile)]) {
      for (const g of p.guides) {
        for (const step of g.steps) {
          expect(step.title.length).toBeGreaterThan(0)
          if (step.kind === 'paramSet') expect(step.params.length).toBeGreaterThan(0)
          if (step.kind === 'check') expect(step.checks.length).toBeGreaterThan(0)
          if (step.kind === 'command') expect(step.actionLabel.length).toBeGreaterThan(0)
        }
      }
    }
  })
})
