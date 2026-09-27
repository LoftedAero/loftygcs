import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import CameraPanel from './CameraPanel'
import { useConnectionStore } from '../../../stores/connection-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import * as camera from '../../../services/camera'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  useConnectionStore.setState({ phase: 'idle' } as never)
  useVehicleStore.setState({ gimbal: null } as never)
})

const connect = () => useConnectionStore.setState({ phase: 'connected' } as never)
const values = () => [...document.querySelectorAll('.cam-dial__value')].map((e) => e.textContent)

describe('the camera pane', () => {
  it('shows each dial empty, not a sentence, before the mount has spoken', () => {
    connect()
    render(<CameraPanel />)
    expect(values()).toEqual(['—', '—'])
  })

  it('reads the mount back on its dials', () => {
    connect()
    useVehicleStore.setState({ gimbal: { rollDeg: 0, pitchDeg: -30, yawDeg: 24 } } as never)
    render(<CameraPanel />)
    expect(values()).toEqual(['-30°', '+24°'])
  })

  it('never reads "-0°" for a mount resting a hair under level', () => {
    connect()
    useVehicleStore.setState({ gimbal: { rollDeg: 0, pitchDeg: -0.2, yawDeg: 0.1 } } as never)
    render(<CameraPanel />)
    expect(values()).toEqual(['0°', '0°'])
  })

  it('steps a dial by five degrees from the keyboard and sends one command', () => {
    const point = vi.spyOn(camera, 'point').mockResolvedValue()
    connect()
    render(<CameraPanel />)
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Camera pitch' }), { key: 'ArrowDown' })
    expect(point).toHaveBeenCalledTimes(1)
    expect(point).toHaveBeenCalledWith(-5, 0, false)
  })

  it('keeps the yaw it was told when the pitch changes', () => {
    const point = vi.spyOn(camera, 'point').mockResolvedValue()
    connect()
    render(<CameraPanel />)
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Camera yaw' }), { key: 'ArrowRight' })
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Camera pitch' }), { key: 'ArrowDown' })
    expect(point).toHaveBeenLastCalledWith(-5, 5, false)
  })

  it('says what happened and then clears it, in a slot that is always there', async () => {
    vi.useFakeTimers()
    vi.spyOn(camera, 'photo').mockResolvedValue()
    connect()
    render(<CameraPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Photo' }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByRole('status').textContent).toBe('Photo: done')
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('turns Record into Stop, named in full and marked as a state rather than a red action', () => {
    vi.spyOn(camera, 'record').mockResolvedValue()
    connect()
    render(<CameraPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    const stop = screen.getByRole('button', { name: 'Stop recording' })
    expect(stop.className).toContain('is-recording')
    expect(stop.className).not.toContain('la-btn--danger')
  })

  it('draws Lock yaw disabled, not missing, on firmware without the gimbal manager', () => {
    connect()
    useVehicleStore.setState({ firmware: null } as never)
    render(<CameraPanel />)
    expect((screen.getByRole('checkbox', { name: 'Lock yaw' }) as HTMLInputElement).disabled).toBe(
      true,
    )
  })
})
