# Screen review — the gate before the next preview

Every screen gets looked at in **both states** before the next preview build
goes out. Two states because they are two different screens: most of the
bugs found so far lived in the disconnected one, which is the one nobody
opens on purpose and the one a new user sees first.

`docs/releasing.md` is the runbook for cutting the build. This is the gate in
front of it.

## What a tick means

A screen is approved when all of this holds. It is the same pass every time,
so a tick from three weeks ago still means something.

**Disconnected**

- It **renders itself rather than describing itself.** No card explaining
  what the screen would have shown. The Fly and Overview screens both used
  to do this and both stopped.
- **Placeholders are null, not zero.** A dash, not a `0`; no green
  `Disarmed`, no `Satellites: 0`, no confident readings for an aircraft that
  is not there. A value with no vehicle behind it must not carry a status
  color.
- **Nothing that commands an aircraft is reachable.** Arm, mode changes,
  takeoff, uploads — all disabled, not merely absent.
- Where there is a route out of the empty state, it names the route that
  exists *in that build*: the SITL tray is Electron-only, so the browser is
  told about the Demo transport instead.

**Connected**

- Real values in every field, and the units are right.
- Anything the vehicle does not have is dropped rather than shown empty —
  or is shown empty *deliberately*, where "configured and reads nothing" is
  a different fault from "not fitted".
- Actions round-trip: what you press is acked, and a refusal says why.

**Both**

- **Fills the window.** No column of cards down one side of a full-screen
  window, and no side padding on an ordinary 16:9. Sane at ultrawide.
- **Dark mode**, checked by looking rather than assuming. Dropdowns, disabled
  controls and anything on a permanently dark ground are the repeat
  offenders — see the design-system notes in `CLAUDE.md`.
- Copy is short. A hint says the one thing needed at the moment it is read.

A screen with no meaningful difference between the two states still gets both
ticks: confirming there is no difference is the check.

Re-approve a screen after any material change to it. A tick is about the
screen as it was seen.

---

## Fly

- [ ] Disconnected
- [ ] Connected

Lower pane, one tab at a time:

- [ ] Messages
- [ ] Status
- [ ] Preflight
- [ ] Camera — needs a mount; an unconfigured one must say so rather than
      look like it worked
- [ ] Joystick — needs a pad. Nothing may move the aircraft until a device
      is chosen and the sticks are safe

Overlays: HUD video source dialog, the View menu, the map and HUD context
menus.

- [ ] Overlays

## Plan

**Approved 2026-09-08.** Covers all three plans and the shared column. The
mode is labeled "Plan"; the plan it opens on is still called Mission, and the
tab id is still `mission`.

- [x] Disconnected
- [x] Connected

Sub-plans, if any of them changes:

- [x] Mission
- [x] Fence
- [x] Rally

---

# Setup

## Initial Setup

### Overview

**Approved 2026-09-08.**

- [x] Disconnected
- [x] Connected

### Firmware

Note: its normal state *is* disconnected — a board in bootloader mode is not
a connection. Flashing itself is still gated on hardware
(`docs/hardware-checklist.md`).

Board first, then firmware, in three numbered steps. **1 Board** holds Detect
board and, beside it, the readout of what was found (`—` until there is
something). Detect identifies what is attached *and* how it can be flashed —
the ArduPilot bootloader takes the `.apj` over its port, a board in DFU mode
takes the `_with_bl.hex` over USB. Only then are **2 Vehicle**'s tiles, **3
Release**'s list and the file picker offered, each narrowed to that board;
Flash board sits beside the release rather than on a row of its own. Every
control is one width from one token, and the status is plain text under
them rather than a panel.

- [ ] Disconnected
- [ ] Connected
- [ ] Nothing is offered before a board is detected: tiles and Open file
      disabled, the line reads "Detect a board to flash. A board that has
      never run ArduPilot must be in DFU mode."
- [ ] The three steps line up: one left edge for the readout, the dropdown
      and both buttons, and the status text starts on it too
- [ ] The card is its own width, not the width of the page
- [ ] The step numbers are legible in **both** themes (soft disc, deep ink —
      white on blue was ~3.5:1 at 11px)
- [ ] Detect board is refused while armed, while flying, and during a
      failsafe — disabled, with the reason on the status line
- [ ] Detect board while connected and standing still: asks before it
      reboots, and says nothing is erased
- [ ] The symbols draw immediately on a cold start, before the build list
      lands, and do not reorder when it does
- [ ] Nothing on the card changes height on any input; the status line
      says what is happening at every step
- [ ] Detect board with a board running ArduPilot: **one** port chooser,
      then the board line shows the right id (a Cube Orange is 140, a Cube
      Orange+ 1063)
- [ ] Detect board while **connected** over MAVLink: the link drops, no
      chooser — it is not refused. Armed is refused
- [ ] Detect board with a board already in its bootloader: no chooser
- [ ] A detect that finds nothing says "Could not detect board, please
      retry." rather than a browser exception
- [ ] Cancelling the port chooser stops quietly, and DFU is still offered
- [ ] A vehicle with no build for this board is disabled, not missing
- [ ] A board id that fits several builds prompts on the vehicle click,
      narrowed to those builds
- [ ] No vehicle picked yet reads "Pick a vehicle type."
- [ ] Copter, Heli and Plane carry no warning; Rover, Sub, Tracker, Blimp
      and AP Periph read "This app is tested for Copter and Plane — some
      functions may not work properly for X"
- [ ] Flash, then cancel at the confirm: the board boots its existing
      firmware, and the board line clears — it is not that board any more
- [ ] Detecting again, and leaving the tab, both boot the old board
- [ ] An older release picked from the dropdown, and a beta at the same
      version number as the stable

With a firmware file opened (Open file, or a build fetched from the custom
builder) — the file wins over the release, so both rows must say so:

- [ ] Step 3 shows the file's name, and the dropdown is closed: no version
      is displayed that is not what will be written
- [ ] No vehicle tile is lit while a file is loaded
- [ ] Clicking a vehicle tile drops the file and returns to the release list

With a board in DFU mode (BOOT0 held while plugging in):

- [ ] Detect board finds it and asks for the target, from the flat catalog
- [ ] First detect of a board this browser has never been granted: it is
      reached *after* the serial path fails, so a port chooser may appear
      first — check the wording gets somebody through it
- [ ] The board line reads "DFU mode · TARGET" and fits without clipping
- [ ] Open file offers only `.hex`; an `.apj` dragged past it is refused
      with "this board takes the _with_bl.hex"
- [ ] An app-only `.hex` (first record not at 0x08000000) is refused
- [ ] An image bigger than the board's flash is refused before any erase
- [ ] Custom build says to download the `_with_bl.hex`
- [ ] A full flash: erase, write, verify, leave, and the board re-enumerates
      with its MAVLink and SLCAN ports. Validated once on a TBS_LUCID_H7_WING
      at 208 s total (erase 76, write 124, verify 8) — a write much slower
      than that is the per-block regression described in `CLAUDE.md`
- [ ] The phase labels read as one voice: Contacting / Erasing / Writing /
      Verifying / Rebooting / Leaving
- [ ] A stalled board says to unplug it and hold BOOT, not "controlTransferOut
      failed"

In the **browser** build, where there is no manifest (CORS) and no shell to
answer the choosers:

- [ ] The line reads "The web version of this app can only flash firmware
      from a file.", tiles and release stay disabled, Open file works
- [ ] A `.apj` opened from a file flashes over the serial bootloader
- [ ] DFU is Chrome/Edge only — Firefox has Web Serial but no WebUSB, and
      should say so rather than fail obscurely
- [ ] A board in DFU mode is adopted with no target prompt (there is no
      catalog to pick from) and the line reads "DFU mode · N KB flash"

### Configuration

- [ ] Disconnected
- [ ] Connected
- [ ] Guided setups — the browser modal, and a guide actually running (it
      replaces the rail as well as the content)

### Ports

- [ ] Disconnected
- [ ] Connected

### Sensors

- [ ] Disconnected
- [ ] Connected
- [ ] Accel calibration wizard, run to the end
- [ ] Compass calibration, including the coverage sphere

## Config/Tuning

### Radio

- [ ] Disconnected
- [ ] Connected
- [ ] Calibration wizard, with a real transmitter if one is to hand

### Flight Modes

- [ ] Disconnected
- [ ] Connected

### Outputs

- [ ] Disconnected
- [ ] Connected
- [ ] Motor test interlocks — props off, and the danger confirm behaves

### Power

- [ ] Disconnected
- [ ] Connected

### Failsafe

Now drawn as a document rather than tiled cards.

- [ ] Disconnected
- [ ] Connected

### OSD

Note: the OSD is a compile-time firmware option, so a build without it is a
legitimate configuration and the screen must say so.

- [ ] Disconnected
- [ ] Connected
- [ ] The screen editor: dragging a panel, and Write

### Tuning

Now split into subtabs, with the gains drawn as a matrix.

- [ ] Disconnected
- [ ] Connected
- [ ] Attitude
- [ ] Navigation
- [ ] On a Plane as well as a Copter — the two draw different matrices and
      only one of them is ever on screen

### Parameter List

- [ ] Disconnected — opens a .param file; Write and Reload stay greyed even
      once a vehicle connects, because a file is not that aircraft
- [ ] Connected
- [ ] Search, a bitmask editor, dirty highlighting
- [ ] File import/export and the compare dialog

## Data

### Log Review

Still the tab id `logs`.

- [ ] Disconnected
- [ ] Connected
- [ ] Download from the vehicle (needs a card; SITL keeps them elsewhere)
- [ ] A log opened from a file: table, plots, 3D replay

### MAVFTP

Note: uploads are refused while the root is showing, because the root is a
merged view and a file written there never comes back in the listing.

- [ ] Disconnected
- [ ] Connected

### Inspector

- [ ] Disconnected
- [ ] Connected
- [ ] Messages
- [ ] Hardware ID — against real hardware if possible; SITL's device IDs are
      its own simulated ones

---

### The Setup rail itself

With nothing connected it lists only Firmware, Parameter List and Logs;
everything else needs a live aircraft and leaves, Overview included. Worth
checking that the three group headings still earn their space with one item
each, and that losing the link while on a vehicle-only tab lands somewhere
rather than nowhere.

- [ ] Disconnected
- [ ] Connected
- [ ] Disconnecting while on Sensors (or any vehicle-only tab)

## Dialogs, overlays and the app bar

Not screens in the rail, but everything here is something someone sees, and
the same two states apply. Where one of them cannot happen, it says so —
that is still a fact worth having written down.

### App bar

Connection controls, the vehicle status row, the mode switch. The row has
more states than the two below and they do not all need a vehicle: opening,
waiting for a heartbeat, a failed connect (which shows the transport's own
words), link lost, connected-but-unidentified, Not ready, Ready, Armed,
Failsafe.

- [ ] Disconnected
- [ ] Connected
- [ ] A vehicle with no battery monitor and no GPS — those readings should be
      absent, not zero
- [ ] The firmware and version readout, which is what a flash changes —
      cross-check it against the Firmware tab after one
- [ ] Narrow: the firmware readout drops at 1700px, the other readings at
      1500px, the status word at 1080px

### Action bar

Write / Revert / Refresh, and the preview marker.

- [ ] Disconnected
- [ ] Connected

### SITL tray

**Approved 2026-09-08.** Its own four states matter more than the link's:
not installed, installing, running, exited.

- [x] Disconnected
- [x] Connected

### Connect dialog (host/port)

- [ ] Disconnected
- [ ] Connected — n/a, it is how you stop being disconnected

### Serial port chooser

- [ ] Disconnected
- [ ] Connected — n/a, it only appears during a connect attempt

### Flying-field picker

**Approved 2026-09-08**, as part of the SITL interface — it is reachable
only from the tray's "Pick on map…" and was reviewed alongside it. Re-check
the arrow against a runway you know, and that the looked-up altitude is
plausible, if either changes.

- [x] Disconnected
- [x] Connected

### Preferences

**Approved 2026-09-08.** Both ticks earned rather than assumed: the dialog
reads the preferences and theme stores and no connection state at all, so
the two states are provably the same screen.

- [x] Disconnected
- [x] Connected

### Unsaved-changes prompt

- [ ] Disconnected — n/a, staged parameter edits need a vehicle to come from
- [ ] Connected, leaving a page with edits outstanding

### Preview notice

As it appears on first run, over whatever is behind it.

- [ ] Disconnected
- [ ] Connected

---

## Not covered here

- Firmware flashing against a real board — `docs/hardware-checklist.md`
- The tester-facing walkthrough that ships with the build —
  `docs/preview-testing.md`
