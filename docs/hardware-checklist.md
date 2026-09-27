# Hardware validation checklist

These checks cover what SITL and the demo vehicle cannot prove. Run them with
a bench vehicle (props off) and, for the flashing section, preferably a spare
board first. Check items off per release.

## Connection and telemetry

- [ ] Web Serial, browser: `npm run dev`, open in Chrome or Edge, plug the
      flight controller in over USB, Connect. The chooser lists the board,
      a heartbeat arrives, and live telemetry appears on Overview.
- [ ] Web Serial, desktop: `npm run dev:electron`, same flow. The port chooser
      is the app's own dialog, not a browser sheet.
- [ ] Unplug mid-session: pull the USB cable while connected. The app reports
      the link closed and returns to idle, and reconnecting works without a
      restart.
- [ ] Telemetry radio: connect through a SiK or ELRS serial radio and check
      that the link statistics (messages per second, dropped bytes) look
      reasonable at radio rates.
- [ ] UDP: a Wi-Fi bridge, or `--out udp:<pc>:14550` from SITL or a vehicle,
      connects with UDP on port 14550.

## Parameters

- [ ] The full parameter table loads from the board. Note whether it came
      over MAVFTP or the stream fallback, and how long it took.
- [ ] Change a harmless parameter (for example `LOIT_SPEED_MS`), Write,
      power-cycle, reconnect: the new value persisted.
- [ ] Export the parameters to a file and import the same file: it loads
      cleanly and stages no changes.

## Setup

- [ ] Accelerometer calibration end to end on the bench (six positions,
      success reported).
- [ ] Compass calibration outdoors: progress climbs, the result is accepted,
      and the offsets are sensible.
- [ ] Radio calibration with a real transmitter: endpoints captured,
      `RCn_MIN`/`MAX`/`TRIM` written, and the bars track the sticks live.
- [ ] Motor test (props off): each motor spins on command, Stop all stops
      them, and the interlock dialog gates the card.

## Firmware flashing (spare board first)

Serial bootloader:

- [ ] Desktop app: the firmware manifest loads, and Detect board on a board
      running ArduPilot reboots it into its bootloader and shows the right
      board id.
- [ ] Detect board while connected over MAVLink: the link drops and the
      board is identified without a port chooser.
- [ ] A firmware file for a different board is refused before erase. Test
      this deliberately with a mismatched `.apj`.
- [ ] The correct build: erase, program with progress, verify, reboot. Then
      reconnect and confirm the new version in the boot messages.
- [ ] Kill the app mid-program, power-cycle, and flash again: it recovers,
      because the bootloader is never touched.
- [ ] Browser build: flash an `.apj` opened from a file in Chrome.

DFU:

- [ ] A board with BOOT0 held while plugging in is found by Detect board. On
      Windows, record what driver setup (WinUSB, Zadig) was needed.
- [ ] The selected release downloads the matching `_with_bl.hex`.
- [ ] The flash completes (erase, write, verify, leave) and the board boots
      ArduPilot with a working bootloader.
- [ ] The "Which board is this?" prompt makes clear that DFU has no board id
      to read, so a wrong target cannot be caught.
