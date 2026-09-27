import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import ParamProgress from './ParamProgress'
import { useParamStore } from '../../stores/param-store'
import type { ParamRecord } from '../../protocol/types'

// The app bar says parameters are loading, wherever you are.

const rec = (name: string, value: number): ParamRecord => ({ name, value, mavType: 4 })
const bar = (c: HTMLElement) => c.querySelector('.app-bar-progress')

beforeEach(() => {
  useParamStore.getState().loaded([rec('OSD_TYPE', 0)])
})
afterEach(cleanup)

describe('the parameter progress bar', () => {
  it('is absent once the set is loaded', () => {
    const { container } = render(<ParamProgress />)
    expect(bar(container)).toBeNull()
  })

  it('appears as soon as a download is asked for', () => {
    // Before the first packet it sweeps, since sitting at 0% reads as stalled.
    useParamStore.getState().beginDownload()
    const { container } = render(<ParamProgress />)
    expect(bar(container)?.className).toContain('is-indeterminate')
  })

  it('draws the fraction once the vehicle is reporting one', () => {
    useParamStore.getState().beginDownload()
    useParamStore.getState().setProgress({ got: 700, total: 1400, source: 'ftp' })
    const { container } = render(<ParamProgress />)
    const el = bar(container)
    expect(el?.className).not.toContain('is-indeterminate')
    expect(el?.getAttribute('aria-valuenow')).toBe('50')
    expect(el?.querySelector('.app-bar-progress__fill')?.getAttribute('style')).toContain('50%')
  })

  it('shows a quiet refresh too', () => {
    // A background re-read never touches loadState (so the curated tabs do
    // not blank), so the bar cannot key off it.
    expect(useParamStore.getState().loadState).toBe('ready')
    useParamStore.getState().setProgress({ got: 10, total: 1400, source: 'ftp' })
    const { container } = render(<ParamProgress />)
    expect(bar(container)).not.toBeNull()
  })

  it('goes away when a quiet refresh finishes', () => {
    useParamStore.getState().setProgress({ got: 10, total: 1400, source: 'ftp' })
    useParamStore.getState().merged([rec('OSD_TYPE', 1)])
    const { container } = render(<ParamProgress />)
    expect(bar(container)).toBeNull()
  })
})
