# Loft GCS

A modern, cross-platform ground control station for [ArduPilot](https://ardupilot.org): the
guided, configurator-style workflow of Betaflight/iNAV, growing toward the feature depth of
Mission Planner. One TypeScript/React codebase that runs two ways:

- **In the browser** (Chrome, Edge, Firefox 151+): zero-install, connects to a flight
  controller over USB via the Web Serial API.
- **As a desktop app** (Windows/macOS/Linux, Electron): the same renderer, plus TCP/UDP
  network links for SITL, telemetry radios, and WiFi bridges.

Status: **Phases 0–5 built.** Everything except firmware flashing is validated against real
ArduPilot SITL — connect + telemetry, full parameter management (MAVFTP fast path + metadata),
setup and calibration wizards, motor test/outputs, and the flight screen (map, HUD,
arm/mode/takeoff; the SITL gate flies a real guided takeoff to altitude and RTL). Phase 4
(firmware flashing) is written and unit-tested against simulated bootloaders, but is not
considered done until it has erased and reflashed a real board — see the roadmap table below.
A hardware-free **demo mode** exercises the whole UI.

## Development

```
npm install
npm run dev            # browser build at the printed URL
npm run dev:electron   # desktop shell against the same dev server
npm test               # vitest
npm run typecheck      # renderer + electron tsconfigs
npm run lint           # includes the layering rules (see below)
npm run dist           # build installers for this platform
npm run package:web    # the web bundle, zipped for a static host
```

## Releasing

[`docs/releasing.md`](docs/releasing.md) is the runbook: what to check before a build, how to
produce the web bundle and the installers, and the platform quirks worth not rediscovering.
The three-platform installer matrix runs **by hand** (Actions → CI → Run workflow), never
automatically.

[`docs/preview-testing.md`](docs/preview-testing.md) is written for the people receiving a
build and travels with the downloads — it covers which channel does what, and how to get past
the security warnings an unsigned build produces on Windows and macOS.

## Testing without hardware

Two options, and they are not interchangeable:

- **Demo mode** (any build, including the browser): a built-in simulated vehicle that streams
  telemetry, answers the parameter protocol, and scripts the calibration flows. Instant, needs
  nothing installed — but it is a stub, not ArduPilot.
- **Simulator** (desktop only): downloads and runs real ArduPilot SITL, then connects over TCP.
  This is the actual firmware — ~1400 parameters over MAVFTP, real arming checks, real mode
  logic. Prebuilt SITL binaries exist for Windows only; on macOS and Linux run `sim_vehicle.py`
  yourself and use *Connect to a running simulator*. Demo mode is in the connection menu;
  SITL is in the app bar's **SITL** tray, which carries a dot while one is running.

There is no browser option for real SITL: ArduPilot has no WebAssembly build, and the artifact
sandbox blocks the WebSocket a remote simulator would need.

## Navigation

Two levels. The top level is a **mode** — *Setup*, *Fly*, or *Mission* — chosen
from the app bar; the latter two are full-window, so only Setup carries a tab rail. The
rail runs in bring-up order: Overview, Firmware, Configuration, Ports, Sensors, Radio,
Flight modes, Outputs, Power, Failsafes, Tuning, OSD, Parameters, Logs. Ports sits ahead of
Sensors on purpose — serial protocol assignment decides whether the external compass and GPS
are detected at all.

Every Setup tab stages parameter edits into one shared store, so **Write Params** lives in
the action bar for all of them rather than appearing and vanishing per screen.

## Architecture

- `src/protocol/` — environment-agnostic MAVLink core: bytes in, typed messages out. No DOM,
  React, Electron, or Node imports. Runs in a Web Worker in the app and in plain Node in
  integration tests.
- `src/transport/` — one `Transport` interface, several backends: Web Serial (browser *and*
  Electron, same file), Electron TCP/UDP (over IPC), WebSocket (mavlink2rest-compatible), and
  a virtual flight controller for hardware-free demos and tests.
- `src/worker/` — the protocol worker and the typed client the UI talks to.
- `src/ui/` — React components. Never imports the protocol directly.
- `electron/` — window shell, Web Serial permission plumbing, and the TCP/UDP socket bridge.
  `contextIsolation` and `sandbox` are on; `preload.ts` is the entire privileged surface.
- `src/styles/lofted-aero.css` — the Lofted Aero design system, copied verbatim (do not fork;
  see `DESIGN.md` in the 3BSM Config project). App-specific styles live in `app.css`, built
  only from the system's tokens.
- `src/profiles/` — vehicle profiles and guided setups. Layered: class profiles (generic
  "multirotor first setup") and product profiles (a *known aircraft* — output map, param
  baseline, bespoke bring-up sequence; `lofted-f35b.ts` is the pilot). Guides are data, not
  code: a step engine (`src/ui/guides/`) executes info / manual / paramSet / command /
  calibration / check steps through the same services the rest of the app uses. Strictly
  opt-in: the only entry point is the "Guided setups…" button on the Setup tab, and product
  labels appear only after the user selects their aircraft (cleared just as easily).

These layering rules are enforced by ESLint (`import/no-restricted-paths`).

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | App shell, dual browser/Electron build, CI | done |
| 1 | Connect + live telemetry (USB, TCP/UDP, WebSocket, demo mode) | done (SITL-validated) |
| 2 | Full parameter management: MAVFTP fast path, official metadata, import/export | done (SITL-validated) |
| 3 | Setup wizards: frame, accel/compass/radio/ESC calibration; motor test | done (SITL-validated) |
| 4 | Firmware flashing: ArduPilot serial bootloader (.apj) + DFU recovery (WebUSB, with-bootloader .hex), official manifest browser | built — hardware gate pending |
| 5 | Flight screen: live map, HUD, arm/mode/takeoff, guided click-to-go | done (SITL flies) |
| 6 | Mission planning: waypoints, survey grids, geofences and rally points | done (SITL-validated) |
| 7 | Log review: MAVFTP download, dataflash parser, plots with expressions, record table, 3D replay | built — flown-log gate pending |
| later | Joystick, signing UI, multi-vehicle, version-matched param metadata | — |

Remaining hardware checks before calling v1 phases fully closed are in
[docs/hardware-checklist.md](docs/hardware-checklist.md) — flashing on a sacrificial board,
Web Serial with a real flight controller, radio cal with a real RC, motor-test interlocks.

## License

GPL-3.0-only. Protocol code ported from pymavlink and other GPL projects carries attribution
in its file headers.

### Third-party 3D models

The airframe models come from [betaflight-configurator](https://github.com/betaflight/betaflight-configurator).
The files are unchanged; the biplane's colors are overridden at load time. Full detail in
[src/models/ATTRIBUTION.md](src/models/ATTRIBUTION.md).

This work is based on ["Low-Poly Biplane"](https://sketchfab.com/3d-models/low-poly-biplane-755175daea384176813e7dc90b2245a5)
by [lord_syrup](https://sketchfab.com/lord_syrup) licensed under
[CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/), used here with its colors changed.

The multirotor model ships in betaflight-configurator with no separate model licence, so it
falls under that project's GPL-3.0 — which is usable here only because this app is GPL-3.0 too.
