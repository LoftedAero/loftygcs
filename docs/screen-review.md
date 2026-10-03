# Screen review checklist

Run this against every screen your change touches before opening a pull
request, and against every screen before a release build. Check each screen
in two states, disconnected and connected. They behave as two different
screens, and the disconnected one is what a new user sees first.

The general rules are in [ux-rules.md](ux-rules.md) and the app-specific ones
in [ui-conventions.md](ui-conventions.md). Checks that need a real board are
in [hardware-checklist.md](hardware-checklist.md).

## Every screen

Disconnected:

- [ ] The screen renders itself rather than a card describing itself.
- [ ] Placeholders are null, not zero: a dash rather than `0`, and no status
      color on a value with no vehicle behind it (no green "Disarmed", no
      "Satellites: 0").
- [ ] Nothing that commands an aircraft is reachable. Arm, mode changes,
      takeoff and uploads are disabled.
- [ ] Any route out of the empty state names a route that exists in that
      build. The SITL tray is desktop-only, so the browser build does not
      mention it.

Connected:

- [ ] Every field shows real values with the right units.
- [ ] Anything the vehicle does not have is dropped, or shown empty
      deliberately where "configured but reads nothing" is a different fault
      from "not fitted".
- [ ] Actions round-trip: each command is acknowledged, and a refusal says
      why.

Both:

- [ ] The screen fills the window: no column of cards down one side, no side
      padding on a 16:9 display, and sensible at ultrawide sizes.
- [ ] Dark mode is checked by looking at it. Dropdowns, disabled controls and
      anything on a permanently dark background are the usual problems.
- [ ] Copy is short. A hint says the one thing needed when it is read.
- [ ] Compact: at 732×412 (the AX12) every setting and action is still
      reachable, nothing runs past the window, and every control is at least
      44px on its short side. Choose Compact in Preferences to check it in a
      large window.

A screen with no difference between the two states still gets both checks;
confirming there is no difference is the check.

## Fly

- [ ] Disconnected
- [ ] Connected
- [ ] Lower pane tabs: Messages, Status, Preflight
- [ ] Camera (needs a mount): an unconfigured mount says so rather than
      appearing to work
- [ ] Joystick (needs a gamepad): nothing moves the aircraft until a device is
      chosen and the sticks are centered with throttle down
- [ ] Overlays: the HUD video source dialog, the View menu, and the map and
      HUD context menus

## Plan

- [ ] Disconnected and connected, for each of Mission, Fence and Rally
- [ ] The three plans place the same elements in the same positions

## Setup: Initial Setup

### Overview

- [ ] Connected (with no vehicle the tab leaves the rail)

### Firmware

Its normal state is disconnected: a board in its bootloader is not a
connection. The screen runs in three numbered steps: 1 Board, 2 Vehicle,
3 Release.

General:

- [ ] Nothing is offered before a board is detected: tiles and Open file are
      disabled, and the status line reads "Detect a board to flash. A board
      that has never run ArduPilot must be in DFU mode."
- [ ] The steps line up: one left edge for the readout, the dropdown and both
      buttons, and the status text starts on it too.
- [ ] The card is its own width, not the page's.
- [ ] Step numbers are legible in both themes.
- [ ] Nothing on the card changes height on any input, and the status line
      says what is happening at every step.
- [ ] The vehicle symbols draw immediately on a cold start, before the build
      list arrives, and do not reorder when it does.
- [ ] With no vehicle picked, the line reads "Pick a vehicle type."
- [ ] Copter, Heli and Plane carry no warning. Rover, Sub, Tracker, Blimp and
      AP Periph show the "tested for Copter and Plane" warning.
- [ ] A vehicle with no build for this board is disabled, not missing.
- [ ] A board id that fits several builds prompts on the vehicle click,
      narrowed to those builds.
- [ ] An older release can be picked, and a beta at the same version number
      as the stable is listed separately.

Detect board:

- [ ] Refused while armed, while flying, and during a failsafe: disabled, with
      the reason on the status line.
- [ ] Connected and standing still: asks before rebooting, and says nothing is
      erased. The link drops; no port chooser appears.
- [ ] Board running ArduPilot: one port chooser, then the correct board id
      (for example, Cube Orange is 140 and Cube Orange+ is 1063).
- [ ] Board already in its bootloader: no chooser.
- [ ] Nothing found: "Could not detect board, please retry.", not a browser
      exception.
- [ ] Canceling the port chooser stops quietly and DFU is still offered.
- [ ] Flash, then cancel at the confirm: the board boots its existing
      firmware and the board line clears.
- [ ] Detecting again, or leaving the tab, boots the previous board back into
      its firmware.

With a firmware file opened (Open file, or a build from the custom builder),
the file takes precedence over the release:

- [ ] Step 3 shows the file name and the release dropdown is closed, so no
      version is displayed that is not what will be written.
- [ ] No vehicle tile is lit while a file is loaded.
- [ ] Clicking a vehicle tile drops the file and returns to the release list.

With a board in DFU mode (BOOT0 held while plugging in):

- [ ] Detect board finds it and asks for the target from the full catalog.
- [ ] On a first detect, when the browser has never been granted the device,
      DFU is reached after the serial path fails, so a port chooser may
      appear first. The wording should get someone through it.
- [ ] The board line reads "DFU mode · TARGET" without clipping.
- [ ] Open file offers only `.hex`; an `.apj` is refused with "this board takes
      the _with_bl.hex".
- [ ] An app-only `.hex` (first record not at 0x08000000) is refused.
- [ ] An image bigger than the board's flash is refused before any erase.
- [ ] Custom build says to download the `_with_bl.hex`.
- [ ] A full flash erases, writes, verifies and leaves, and the board
      re-enumerates with its MAVLink and SLCAN ports. For reference, a 1.6 MB
      image on an H7 board took about 208 s (erase 76 s, write 124 s, verify
      8 s); a much slower write suggests a per-block regression.
- [ ] Phase labels read consistently: Contacting, Erasing, Writing, Verifying,
      Rebooting, Leaving.
- [ ] A stalled board reads "The board stopped accepting DFU commands. Please
      reboot and reconnect it, still in DFU mode." A stall during the write or
      read-back also names the address and block. Raw browser errors go to the
      flash log, not the screen.

In the browser build, where there is no firmware manifest (CORS) and no shell
to answer device choosers:

- [ ] The line reads "The web version of this app can only flash firmware from
      a file."; tiles and release stay disabled and Open file works.
- [ ] An `.apj` opened from a file flashes over the serial bootloader.
- [ ] DFU works in Chrome and Edge only. Firefox has Web Serial but no WebUSB
      and should say so rather than fail obscurely.
- [ ] A board in DFU mode is adopted with no target prompt and the line reads
      "DFU mode · N KB flash".

### Configuration

- [ ] Connected

### Ports

- [ ] Connected

### Sensors

- [ ] Connected
- [ ] Accelerometer calibration, run to the end
- [ ] Compass calibration, run to the end: the six attitude tiles, the
      per-compass progress bars, the result, and the reboot prompt
- [ ] Compass priority and the card's settings
- [ ] Hardware ID

## Setup: Config/Tuning

For every screen in this group, check Copter, Plane and a quadplane at
1920×1100 and 2556×1393: no scrolling, nothing clipped, and columns ending on
one line.

### Radio

Four cards on every vehicle: Channels, Stick mapping, Auxiliary functions and
Receiver options.

- [ ] Connected
- [ ] Channels is the same height with the transmitter off, an 8-channel
      receiver and a 16-channel one.
- [ ] Calibration: every stick both ways, with the throttle held up through
      both yaw steps. Switches and dials are optional. Save closes the dialog
      and leaves "Calibration saved" on the card; the restart prompt appears
      only when the stick mapping changed.
- [ ] Calibration with a real transmitter, if one is available.

### Flight Modes

- [ ] Connected

### Outputs

- [ ] Connected
- [ ] Motor test interlocks: props-off confirmation and the danger confirm

### Power

A Battery 1 / Battery 2 switch over the same three cards on every vehicle:
Live reading, Battery monitor and Battery failsafe.

- [ ] Connected, with both batteries' views identical in shape.
- [ ] A monitor with no pins (DroneCAN, SMBus): the analog rows grey out and
      the card keeps its height.
- [ ] Enabling Battery 2 writes immediately, its rows come live with no change
      in card height, and the restart prompt appears. After the restart its
      live reading comes from its own BATTERY_STATUS.

### Failsafe

The same cards on every vehicle: Arming, Radio failsafe, Ground station
failsafe, Return to launch, Fence, EKF and crash, and VTOL assist on a
quadplane.

- [ ] Copter: 4.7's `RTL_ALT_M`, `RTL_ALT_FINAL_M` and `RTL_CLIMB_MIN_M` in
      meters; `ARMING_SKIPCHK`.
- [ ] Plane: `FS_GCS_ENABL`, the short and long radio failsafe,
      `CRASH_DETECT`.
- [ ] Quadplane: the VTOL return rows and the VTOL assist card.

### OSD

The OSD is a compile-time firmware option, so a build without it is a valid
configuration and the screen must say so.

- [ ] Connected, with the OSD enabled and with `OSD_TYPE` at 0 (drawn
      disabled, not replaced)
- [ ] The screen editor: dragging a panel, and Write
- [ ] One settings column: actions, layout file, Display, Screen switching,
      the screen being edited, Warnings. Every control is one width; the
      layout toolbar holds only the screen picker and the grid.
- [ ] Above 1360px wide, all three columns end on one line, the preview grows
      with the window at the grid's aspect ratio, and only the panel list and
      settings column scroll.

### Filters

The IMU card beside the rate filters, then the two harmonic notches side by
side at one height. A quadplane's VTOL rate filters are rows of the Rate
filters card.

- [ ] Each notch shows its enable, with the following rows greyed until it is
      on and the vehicle has restarted.
- [ ] Enabling a notch and restarting brings its rows live without changing
      the card's height.
- [ ] Rate filters use the vehicle's own names: `ATC_RAT_` on Copter,
      `RLL_RATE_` on Plane, both on a quadplane.

### Tuning

Cards in two columns that fit an 1100px-tall window without scrolling.

- [ ] Copter: Autotune, Rate gains and Attitude on the left; the horizontal
      and vertical position controllers and Navigation on the right, named
      from ArduPilot's metadata. 4.7's renamed parameters (`WP_SPD`,
      `PSC_D_ACC_P`, and others) with units from the metadata; lean angle max
      and input time constant under the angle gains, with the time constant's
      presets labeled in seconds.
- [ ] Plane: rate gains, attitude with its limits, L1, TECS and autotune; no
      multirotor cards, yaw damper or throttle.
- [ ] Quadplane: the Fixed wing / VTOL switch, each view laid out exactly like
      the standalone Plane and Copter pages, with VTOL on the `Q_` parameters.
- [ ] Quadplane hardware: Quicktune appears in the VTOL Autotune card
      (official builds carry `QWIK_`, not `Q_AUTOTUNE_`), and enabling it
      brings its rows live without a restart.
- [ ] Enabling VTOL on Configuration brings in the switch without a reload.

### Parameter List

- [ ] Disconnected: opens a `.param` file. Write and Reload stay disabled even
      after a vehicle connects.
- [ ] Connected
- [ ] Search, the bitmask editor, and dirty-row highlighting
- [ ] File import and export, and the compare dialog

## Setup: Data

### Log Review

- [ ] Disconnected and connected
- [ ] Download from the vehicle (needs an SD card on hardware; SITL stores
      logs elsewhere)
- [ ] A log opened from a file: table, plots and 3D replay

### MAVFTP

- [ ] Connected
- [ ] Upload is refused while the root is showing (the root is a merged view
      and a file written there never appears in the listing)

### Inspector

- [ ] Connected
- [ ] Messages
- [ ] Hardware ID, against real hardware if possible (SITL reports simulated
      device IDs)

## Setup rail

With nothing connected, the rail lists only Firmware, Parameter List and Log
Review.

- [ ] Disconnected and connected
- [ ] The group headings still make sense with one item each
- [ ] Disconnecting while on a vehicle-only tab (for example Sensors) lands on
      a remaining tab

## App bar, dialogs and overlays

### App bar

The status row has more states than connected and disconnected: opening,
waiting for a heartbeat, a failed connect (showing the transport's error),
link lost, connected but unidentified, Not ready, Ready, Armed and Failsafe.

- [ ] Each of the states above
- [ ] A vehicle with no battery monitor and no GPS shows those readings as
      dashes or "No GPS", not zeros
- [ ] The firmware and version readout matches the Firmware tab after a flash
- [ ] At narrow widths the firmware readout drops at 1700px, the other
      readings at 1500px, and the status word at 1080px

### Footer

- [ ] The version, and the Preview chip on preview builds

### SITL tray (desktop)

- [ ] Its own states: not installed, installing, running and exited
- [ ] The flying-field picker: the heading arrow matches a known runway and
      the looked-up altitude is plausible

### Other dialogs

- [ ] Connect dialog (TCP, UDP, WebSocket): one shape across all three
- [ ] Serial port chooser
- [ ] Preferences
- [ ] Unsaved-changes prompt, when leaving a page with edits outstanding
- [ ] Preview notice, on first run, over whatever is behind it
