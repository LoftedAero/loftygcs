# Hardware validation checklist

These checks cover what SITL cannot prove. Run them with
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

## Android handheld (AX12)

- [ ] Install the release APK; the launcher shows the Lofty icon and the app
      opens full screen in the compact layout.
- [ ] UDP through the ELRS Backpack's WiFi: a heartbeat arrives, parameters
      download, and a mode change from the bar's mode picker takes effect.
- [ ] Internal serial (`/dev/ttyS1`): telemetry arrives. Note whether
      anything sent reaches the aircraft (on the unit tested so far, nothing
      does).
- [ ] Voice callouts through the radio's speaker: a mode change is spoken,
      and Test in Preferences plays the info beep, the warning beep and a
      voice line in order.
- [ ] Arm and Takeoff from the command strip (props off): each needs the
      slide, and the slide withdraws on its own after 10 s.

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

## Lofty PFD on a radio's SD card

Copy the card first: an install removes whatever Lofty PFD's folders hold that the
release does not list.

- [ ] Desktop app: Install on radio onto a card without Lofty PFD, then again onto
      the same card (an update). The radio starts Lofty PFD.
- [ ] Chrome: the same, through the browser's folder picker.
- [ ] A card for the other radio family (EdgeTX or Ethos) is detected by its own
      layout, and a folder named like one in the layout is refused.

## Lofted Aero boards (F405-SRX)

Run with the desktop app and with Chrome, the trace on for the desktop app
(`LOFTGCS_DEBUG_SERIAL=1 LOFTGCS_DEBUG_USB=1 npm run dev:electron`). A first flash
erases the board, parameters included.

Desktop app:

- [x] First flash in DFU: Prepare finds the board, "Erase and install" runs the
      DFU write, ArduPilot connects with no chooser, the receiver is written, the
      replug prompt appears, and the check shows three green lines (board 1,
      2026-11-14).
- [x] Update of a connected board: one press, "Flashing complete." for 5 s.
- [x] Update of a board plugged in but not connected: no chooser, and the trace
      shows the auto-answer picking the `-BL` port, never the running one (board 1, 2026-11-16).
- [ ] Nothing plugged in: the press opens the wizard's DFU guide; plugging the
      board in DFU finds it without a press.
- [ ] Interrupted receiver write (close the app during "Writing the
      receiver…"): on the next connection the restore dialog appears, and
      Restore leaves the relays off and the receiver on RCIN.

Chrome (`npm run dev`):

- [ ] First flash: the press shows the serial chooser, then the DFU chooser
      (cancel the first); "Select board" covers a board not yet granted.
- [ ] After the DFU write, the wizard either connects to a granted port or
      shows "Select the flight controller’s port." with Continue; Continue's
      chooser lists the board and the flash goes on.
- [ ] The receiver write runs over Web Serial: esptool opens the port, and the
      replug is found by itself or by Connect once it turns on after 15 s.
- [ ] Update of a board plugged in but not connected: one serial chooser, then
      no other prompt.
- [ ] Edge: the same first flash.
