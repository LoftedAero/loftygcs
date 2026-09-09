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

## Mission

**Approved 2026-09-08.** Covers all three plans and the shared column.

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

- [ ] Disconnected
- [ ] Connected

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

- [ ] Disconnected
- [ ] Connected
- [ ] Search, a bitmask editor, dirty highlighting
- [ ] File import/export and the compare dialog

## Data

### Logs

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

## Dialogs, overlays and the app bar

Not screens in the rail, but everything here is something someone sees, and
the same two states apply. Where one of them cannot happen, it says so —
that is still a fact worth having written down.

### App bar

Connection controls, link status, the mode switch.

- [ ] Disconnected
- [ ] Connected

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
