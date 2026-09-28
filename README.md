# Loft GCS

A cross-platform ground control station for [ArduPilot](https://ardupilot.org). It aims for the
screen-by-screen setup of configurators like Betaflight and INAV together with the depth
of Mission Planner: setup and calibration, full parameter management, mission planning, flying,
and log review.

One TypeScript and React codebase runs two ways:

- **In the browser** (Chrome, Edge, Firefox 151+): nothing to install. Connects to a flight
  controller over USB with the Web Serial API, or to a WebSocket bridge.
- **As a desktop app** (Windows, macOS, Linux, built with Electron): the same interface, plus
  TCP and UDP links for SITL, telemetry radios and Wi-Fi bridges, HUD video, and a managed
  ArduPilot SITL.

Status: **preview**. The app is in active development and has not had a stable release.

## Features

- **Connect** over USB serial, TCP, UDP or WebSocket.
- **Setup**, in bring-up order: firmware flashing (ArduPilot serial bootloader and STM32 DFU),
  frame and configuration, serial ports, accelerometer and compass calibration, radio
  calibration, flight modes, outputs and motor test, power, failsafes, filters, tuning and OSD
  layout.
- **Parameters**: fast download over MAVFTP with a stream fallback, documentation matched to the
  firmware version, staged edits, compare, and `.param` files opened without a vehicle.
- **Plan**: missions, geofences and rally points on a map, survey grids, terrain clearance,
  KML/GPX import and export, and offline map downloads.
- **Fly**: map and HUD, arming, modes and guided commands, live plots of any telemetry field,
  ADS-B traffic, camera and gimbal control, HUD video over RTSP or RTP, and gamepad control.
- **Data**: log download over MAVFTP, log review with plots, expressions and a 3D replay, a
  MAVFTP file browser, and a MAVLink inspector.

## Getting started

Requires Node.js 22 or later.

```sh
npm install
npm run dev            # browser build at the printed URL
npm run dev:electron   # desktop app against the same dev server
```

With no flight controller, use ArduPilot SITL: on Windows the desktop app can download and run
it from the **SITL** tray in the app bar. On macOS and Linux, run ArduPilot's `sim_vehicle.py` and connect over TCP or UDP.

## Development

```sh
npm test               # unit and component tests (Vitest)
npm run typecheck      # renderer and Electron projects
npm run lint           # ESLint, including the layering rules
npm run dist           # installers for this platform
npm run package:web    # the web build, zipped for a static host
```

These checks (`test`, `typecheck`, `lint`, `format:check`) run in CI and must pass.

Protocol features are tested against ArduPilot SITL:

```sh
npm run sitl:fetch     # once: download the prebuilt Windows SITL
npm run sitl           # serve a Copter on 127.0.0.1:5760 (add "-- plane" for Plane)
SITL=1 npm test        # run the integration tests against it
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

## Architecture

- `src/protocol/`: the MAVLink core, environment-agnostic (no DOM, React, Electron or Node
  imports). It runs in a Web Worker in the app and in plain Node in the integration tests.
- `src/transport/`: one `Transport` interface with Web Serial, Electron TCP/UDP and WebSocket
  backends.
- `src/worker/`: the protocol worker and the typed client the UI talks to.
- `src/services/` and `src/stores/`: connection, parameters, missions, logs and other state.
- `src/ui/`: React screens. The UI reaches the protocol only through the worker client and the
  stores.
- `electron/`: the desktop shell. `contextIsolation` and `sandbox` are on, and `preload.ts` is
  the entire privileged surface.
- `src/styles/`: `lofted-aero.css` is a vendored design-system stylesheet and is not edited
  here; app styles live in `app.css`, built from its tokens.

ESLint enforces the layering rules. [docs/architecture.md](docs/architecture.md) covers each
subsystem and the ArduPilot behaviors the code depends on.

## Documentation

- [docs/architecture.md](docs/architecture.md): subsystems, protocol notes and design decisions
- [docs/ux-rules.md](docs/ux-rules.md) and [docs/ui-conventions.md](docs/ui-conventions.md):
  how screens are designed and built
- [docs/screen-review.md](docs/screen-review.md): the checklist for UI changes
- [docs/hardware-checklist.md](docs/hardware-checklist.md): checks that need real hardware
- [docs/preview-testing.md](docs/preview-testing.md): installing and testing a build
- [docs/releasing.md](docs/releasing.md): the release process

## Scope

Loft GCS is an ArduPilot ground station. PX4 support, multi-vehicle control, telemetry log
(tlog) recording, RTK/NTRIP injection, voice announcements and antenna tracking are out of scope
for now.

## Contributing

Bug reports and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md)
first, and open an issue to discuss larger changes before starting on them.

## License

GPL-3.0-only. See [LICENSE](LICENSE). Code ported from other GPL projects (pymavlink and
Betaflight Configurator) carries attribution in its file headers.

### Third-party models

The airframe models come from
[betaflight-configurator](https://github.com/betaflight/betaflight-configurator), unchanged
apart from colors applied at load time. The biplane is
["Low-Poly Biplane"](https://sketchfab.com/3d-models/low-poly-biplane-755175daea384176813e7dc90b2245a5)
by [lord_syrup](https://sketchfab.com/lord_syrup), licensed under
[CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/). The multirotor model ships with
betaflight-configurator under GPL-3.0. Details are in
[src/models/ATTRIBUTION.md](src/models/ATTRIBUTION.md).
