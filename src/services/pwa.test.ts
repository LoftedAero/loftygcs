import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isElectron, isNativeApp } from '../env'
import { startPwa, usePwaStore } from './pwa'

vi.mock('../env', () => ({ isElectron: vi.fn(() => false), isNativeApp: vi.fn(() => false) }))

beforeEach(() => {
  vi.stubEnv('PROD', true)
  vi.stubGlobal('isSecureContext', true)
  usePwaStore.setState({ state: 'unavailable', updateWaiting: false })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('browser offline registration', () => {
  function container(register = vi.fn().mockRejectedValue(new Error('Storage denied'))) {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } })
    return register
  }

  it.each(['electron', 'native', 'development', 'insecure'])(
    'does not register in %s',
    async (kind) => {
      const register = container()
      if (kind === 'electron') vi.mocked(isElectron).mockReturnValueOnce(true)
      if (kind === 'native') vi.mocked(isNativeApp).mockReturnValueOnce(true)
      if (kind === 'development') vi.stubEnv('PROD', false)
      if (kind === 'insecure') vi.stubGlobal('isSecureContext', false)
      await startPwa()
      expect(register).not.toHaveBeenCalled()
      expect(usePwaStore.getState().state).toBe('unavailable')
    },
  )

  it('reports unavailable storage without rejecting app startup', async () => {
    container()
    await startPwa()
    expect(usePwaStore.getState().state).toBe('error')
  })

  it('tracks completed installation and waiting updates without sending activation messages', async () => {
    const worker = Object.assign(new EventTarget(), { state: 'installing', postMessage: vi.fn() })
    const reg = Object.assign(new EventTarget(), {
      installing: worker as typeof worker | null,
      active: null as typeof worker | null,
      waiting: null as typeof worker | null,
    })
    const register = container(vi.fn().mockResolvedValue(reg))
    await startPwa()
    expect(usePwaStore.getState().state).toBe('installing')
    expect(register.mock.calls[0]![0].pathname).toMatch(/\/sw.js$/)
    reg.active = worker
    reg.installing = null
    worker.dispatchEvent(new Event('statechange'))
    expect(usePwaStore.getState().state).toBe('ready')
    reg.waiting = worker
    reg.dispatchEvent(new Event('updatefound'))
    expect(usePwaStore.getState().updateWaiting).toBe(true)
    expect(worker.postMessage).not.toHaveBeenCalled()
  })
})
