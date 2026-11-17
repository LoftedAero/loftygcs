import { create } from 'zustand'

// State shared between the Lofted Aero card (its wizard and its update), the
// restore dialog, which opens on connect from any screen, and the Firmware
// card, whose flash store the Lofted Aero card's flashes go through.

interface BoardSetupState {
  /**
   * The Lofted Aero card is driving the board. Its reconnections pass through
   * states the restore dialog would otherwise offer to put right.
   */
  busy: boolean
  setBusy: (busy: boolean) => void
  /**
   * A board the Firmware card identified and holds in its bootloader. The
   * Lofted Aero card updates one of its own from here, since a board in its
   * bootloader cannot be connected to; it clears this once the board has
   * left the bootloader, which tells the Firmware card to let go of it.
   */
  held: HeldBoard | null
  setHeld: (held: HeldBoard | null) => void
}

export interface HeldBoard {
  boardId: number
  port: SerialPort
}

export const useBoardSetupStore = create<BoardSetupState>((set) => ({
  busy: false,
  setBusy: (busy) => set({ busy }),
  held: null,
  setHeld: (held) => set({ held }),
}))
