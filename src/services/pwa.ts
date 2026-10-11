import { create } from 'zustand'
import { isElectron, isNativeApp } from '../env'

type OfflineState = 'unavailable' | 'installing' | 'ready' | 'error'
export const usePwaStore = create<{
  state: OfflineState
  updateWaiting: boolean
}>(() => ({ state: 'unavailable', updateWaiting: false }))

let starting = false

/** A failed install must not prevent an online launch or a vehicle connection. */
export async function startPwa() {
  if (
    starting ||
    !import.meta.env.PROD ||
    isElectron() ||
    isNativeApp() ||
    !window.isSecureContext ||
    !('serviceWorker' in navigator) ||
    !/^https?:$/.test(location.protocol)
  )
    return
  starting = true
  usePwaStore.setState({ state: 'installing' })
  try {
    const registration = await navigator.serviceWorker.register(
      new URL('sw.js', document.baseURI),
      { scope: './', updateViaCache: 'none' },
    )
    const refresh = () => {
      usePwaStore.setState({
        state: registration.active ? 'ready' : registration.installing ? 'installing' : 'error',
        updateWaiting: !!registration.waiting,
      })
    }
    const watchInstalling = () => {
      registration.installing?.addEventListener('statechange', refresh)
      refresh()
    }
    registration.addEventListener('updatefound', watchInstalling)
    watchInstalling()
    // A worker waits until every controlled window closes. No skipWaiting,
    // controllerchange reload, or update timer can interrupt a flight.
  } catch {
    usePwaStore.setState({ state: 'error' })
  } finally {
    starting = false
  }
}
