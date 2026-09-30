# Lofty GCS architecture

Lofty GCS is a cross-platform ArduPilot ground station. One React + TypeScript + Vite
renderer is shared by a browser PWA and an Electron desktop app. This document records how
the code is organized and the rules and traps that keep it working. Each rule is stated with
its reason so it can be argued with; code comments carry the detail for a single file.

Related documents:

- `docs/ui-conventions.md`: how screens in this app are put together (classes, tokens,
  layout conventions).
- `docs/ux-rules.md`: the general UX guidelines behind those conventions, with a checklist to
  run on a new screen.
- `docs/screen-review.md`: the per-screen review gate before a preview build.
- `docs/releasing.md`: the release runbook.

## Source layout and layering

| Directory       | Role                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/protocol`  | MAVLink encode/decode, protocol clients (parameters, missions, MAVFTP, bootloaders), pure logic. Environment-agnostic. |
| `src/transport` | Byte links: Web Serial, WebSocket, and Electron-hosted TCP/UDP.                                                        |
| `src/worker`    | The protocol engine runs in a Web Worker; `worker-client` is the renderer's handle to it.                              |
| `src/services`  | Operations that combine protocol, transport and browser APIs (connection, flashing, tile cache, terrain, video).       |
| `src/stores`    | Application state (Zustand stores).                                                                                    |
| `src/ui`        | React components: `shell/` for the app bar and dialogs, `tabs/` for screens.                                           |
| `electron/`     | Main process, preload, SITL management, video receiver, serial/USB choosers.                                           |

The layering is enforced by ESLint (`import/no-restricted-paths` in `eslint.config.*`):

- `src/protocol` imports nothing from the DOM, React, Electron or Node. It must run in a Web
  Worker and in plain Node, which is what keeps it testable against SITL from a Node test.
- `src/transport` may import from `protocol` and never from `ui`, `stores` or `services`.
- `src/ui` reaches the protocol only through `src/worker/worker-client` and the stores. The
  one exception is `protocol/types.ts`.

Code that needs sockets or the filesystem for tests lives in `src/test-fixtures`, not beside
the protocol tests, for the same reason.

High-rate telemetry never goes through React state. The worker's batches are written into
preallocated ring buffers (`services/telemetry-ring.ts`) and read imperatively on
`requestAnimationFrame` by the HUD and the map.

Product identity (name, preview flag) lives only in `src/brand.ts`. The desktop app id,
`com.loftedaero.gcs` in package.json, must never change once a build has shipped: installers
and the OS key their records on it. Electron names the data folder after the product, and
`main.ts` moves a folder left by the old name (Loft GCS) into place on first launch.

## Electron shell

- `contextIsolation` and `sandbox` stay on. The whole privileged surface is
  `electron/preload.ts`, and its types are mirrored in `src/types/loftgcs.d.ts`. Change the
  two together.
- Link sockets and the video receiver live in the main process and are closed one at a time
  by the renderer that opened them. A renderer reload discards the ids and would leave the
  sockets open; a bound one (a UDP link, the video port) then fails the next attempt with
  EADDRINUSE while nothing appears to be running. `main.ts` therefore drops that state on
  `did-start-loading` and `render-process-gone` as well as on quit. The SITL process is
  exempt: it is a separate process serving a port, and reloading the window is not a reason
  to end a flight.
- The main process owns the Web Serial and WebUSB choosers (`select-serial-port`,
  `select-usb-device`), which is what lets the firmware flow pick a bootloader port without
  showing a chooser. See [Firmware](#firmware).
- `LOFTGCS_DEBUG_SERIAL=1` and `LOFTGCS_DEBUG_USB=1` trace the main process's side of the
  serial and USB choosers. The shell shows no chooser when it answers one itself, so these
  traces are the only way to see why a device was or was not found.

## Design system and styling

### The shared stylesheet

`src/styles/lofted-aero.css` is vendored from Lofted Aero's shared design system and must not
be edited in this repo. It must stay byte-identical to the upstream copy (md5
`2f96f253a92dda2da2023d7330c4ea37`). Changes go upstream and are pulled in as a whole file.

App styles go in `src/styles/app.css` and are built only from `--la-*` tokens: no raw hex
colors and no raw pixel gaps. Two kinds of definition are the exception: the app-local
`--app-*` tokens, and the dark palette under `:root[data-theme='dark']`, which cannot express
a token in terms of itself.

Color semantics: orange is the one primary action per region; blue is working controls; green
and red are status only, never actions. Units go in `.la-field__unit`; validation goes in a
`.la-hint` beside the control. A hint says the one thing someone needs when they read it.
Reasoning belongs in a code comment.

### Dark mode

Dark mode is an app-local override because the shared sheet is frozen.

- `--la-charcoal` is both the app bar's background and heading ink; dark mode moves them in
  opposite directions, so the text uses are overridden separately.
- Anything on a permanently dark ground (the app bar, the OSD preview, video captions, text on
  a green chip) uses `--app-on-dark`, never `--la-surface`. Tones there are lifted toward white
  with `color-mix` from their own token.
- A color inside a data URI cannot follow a token: the `.la-select` chevron is re-inlined under
  the dark block, duplicating `--la-ink-2`'s dark value. `mask-image` plus `background-color`
  would remove that.
- The platform draws `<select>` dropdowns and does not reliably honor `color-scheme`, so
  `color` and `background` are pinned on `.la-select option` in both themes.
- Leaflet's popups and tooltips are restyled in `--la-*` tokens in `app.css`.

### Stacking and overflow

- `.la-appbar` is a stacking context (a grid item with a z-index), so nothing inside it can
  rise above Leaflet's controls. Panels opening from the bar are portaled to `document.body`
  with `position: fixed`. Their click-away must test the panel as well as the trigger, in the
  capture phase, because Leaflet stops mousedown propagation.
- A flyout from a scrolling strip must be `position: fixed`, placed from the button's
  `getBoundingClientRect()`, or the `overflow: auto` ancestor clips it. The symptom is an
  element that measures correctly while `elementFromPoint` returns something else.
- `LaModal` is not portaled; it is `position: fixed`. An ancestor with a `transform` (or
  `filter`) becomes its containing block and clips it to that box, so center overlays with
  margins or grid, not `translate`.
- A Leaflet popup holding controls must stop click, wheel and keydown propagation. Plan edits
  rebuild the marker layer, so an open popup is reopened after the rebuild.

## Navigation (`src/stores/ui-store.ts`)

- Two levels. The top level is a mode (Fly, Plan, Setup), switched from the app bar. Only
  Setup has a tab rail; Fly and Plan take the whole window.
- Labels change, ids do not. The Plan mode's id is `mission` and Log Review's is `logs`,
  because saved state and deep links store ids.
- The app opens on Fly, which draws with or without a vehicle. This is safe because every
  control that commands the aircraft is gated on `connected` in `FlightControls`;
  `App.test.tsx` pins that property.
- The mode switch is never orange; Connect owns the app bar's primary action.
- The Setup rail is grouped as Initial Setup, Config/Tuning and Data, from a `group` field on
  `TABS` so a tab cannot land in a group the rail does not draw. Order within a group follows
  a bring-up. Ports precedes Sensors because `SERIALn_PROTOCOL` gates detection of an external
  compass and GPS; calibrating a compass the firmware never found is a dead end.
- With no vehicle, the rail lists only screens whose subject is a document rather than live
  vehicle state (`visibleTabs`, `offline: true`): Firmware, Parameter List (opens a `.param`)
  and Logs (opens a `.bin`). Overview draws the vehicle, so it is not offline. Losing the link
  on a vehicle-only tab moves to the first remaining tab, read from the list. The
  `NeedsVehicle` cards stay in those tabs to cover the one render between disconnect and
  redirect.
- The simulator is not a mode. It lives in the app bar's SITL tray (`ui/shell/SimTray.tsx`),
  whose open state is in `ui-store` so other screens can open it. The tray's dot shows a SITL
  running in the background.

## App bar and screen layout

The rules for composing screens are in `docs/ui-conventions.md`. This section records the CSS
mechanisms behind them.

### App bar

- The bar is a three-track grid, `1fr auto 1fr`: the app on the left (brand, mode switch, SITL
  tray, preferences), the link on the right, the vehicle status in the middle. Only the middle
  track changes size, so controls never move when a status changes.
- There are no spacers: the shared sheet's `.la-appbar__spacer` is overridden by
  `.la-appbar > * { flex: none }` and never flexes. Do not put `min-width: 0` on a side band,
  or its track shrinks under its content and runs into the status.
- Room is made by dropping whole items at breakpoints (readings at 1500px, the status word at
  1080px), never by clipping a reading.
- The vehicle indicators (`ui/shell/AppStatus.tsx`, `app-status.ts`) render nothing with no
  vehicle and a fixed set with one; a value never sent is a dash, never a zero. Color comes only
  from the vehicle's thresholds (`BATT_LOW_VOLT`, `BATT_CRT_VOLT`, the 3D-fix requirement). The
  status word shares `armReadiness` with the Preflight pane, and strings come from
  `hud-draw.ts`'s formatters.
- Parameter download progress (`ui/shell/ParamProgress.tsx`) is on the app bar because the
  download runs on connect, reboot and gating writes, not for one screen. It keys off
  `progress` as well as `loadState` (a quiet refresh never touches `loadState`) and is
  absolutely positioned so it moves nothing.

### Setup grid and actions column

- Setup cards tile as `repeat(auto-fill, minmax(460px, 1fr))`, capped at three columns by a
  media query at 2136px. Cap the count, never the width. Use `auto-fill` (`auto-fit`
  stretches a lone card) and `align-items: start`. `.app-content--flush` must undo every grid
  property, `align-items` above all.
- The actions column is `.app-col-shell` (frame, scrolling) around `.app-col` (padding,
  rhythm); both are required except inside an already-framed card.
  `src/styles/panel-frame.test.ts` pins the selectors allowed to draw the frame.
- Every screen with a column declares `fills: true`. On the card grid `flex: 1` is inert, so
  without it the page scrolls instead of the pane and virtualized lists have no bounded height.
- The column sits in the main pane's grid row, so both panels share top and bottom lines.
- A screen that cannot be used yet is drawn disabled, not replaced. The OSD screen with
  `OSD_TYPE` at 0 disables everything (`osdOff`); replacing it would also remove the Display
  card where `OSD_TYPE` is set.

### Compact Setup

Compact mode (`ui/compact.ts`, `data-compact` on the root) keeps every Setup screen and
changes how each is laid out. The rules are in the compact block at the end of `app.css`.

- There is no rail. The mode switch's Setup button names the current screen and opens the
  rail's groups as a panel (`SetupScreenPicker` in `NavRail.tsx`). It has one width for every
  screen name, and the bar's grid becomes `auto 1fr auto` with the status anchored beside the
  link, so nothing moves when the screen or the mode changes.
- Cards lose the title's rule and some padding. A curated row hides its ArduPilot name by
  collapsing that track of `--app-named-tracks` to zero rather than removing it, so rows built
  by hand on the same tracks keep their columns.
- An actions column is a drawer (`ColumnShell`, `.app-drawer`) opened by `ColumnToggle` in the
  pane's toolbar. It stays mounted while closed, because its buttons own hidden file inputs
  and dialogs, and it is `position: fixed` so no screen's grid or scroll container can move
  it. Write moves to the toolbar (`ToolbarWrite`) and the column's own is hidden
  (`.app-col__primary`). Log Review has a drawer on each side once a log is open, and keeps
  its column in place before that. Inspector opens its drawer when a message is picked.
- A table too wide for the window keeps what is watched in the row and opens the rest beneath
  it (Outputs: function and position, then travel). The frame picker is one row of thumbnails
  that scrolls sideways.

## Links and messages

### Link errors (`services/link-error.ts`)

`Transport.open` must reject with a user-readable Error, but the IP transports reject with
whatever Node threw, wrapped by Electron's IPC. `describeLinkError` matches the error code
(stable across platforms) rather than the text, and names the target the user typed
("Something is already using port 14550"). An error with no code falls through to its cleaned
text. Cancelling the Web Serial chooser (NotFoundError) returns to idle, not to an error. A link
that drops mid-session is cleaned the same way.

### Capability bits are not evidence

Do not gate a feature on a MAVLink capability bit. Real flight controllers and ArduPlane SITL
report no `MAV_PROTOCOL_CAPABILITY_FTP` while serving MAVFTP. The bits are decoded into
`vehicle-store` for display only; act on what an operation answers (an ack, a listing, a NAK).
Likewise, an unrecognized value is not an absent one.

### Telemetry requests (`requestTelemetry` in `protocol/engine.ts`)

ArduPlane (and Rover before 4.7) saves a `REQUEST_DATA_STREAM` into its stream-rate parameters
(`SRn_*`, renamed `MAVn_*` in 4.7), so a GCS that sends one overwrites rates the user chose for
the link, such as the reduced ones an ELRS link needs. Copter, Sub, Blimp and Tracker do not
save it, and Copter's defaults are 0, so the request is what makes it stream at all.

- Vehicles that save it (fixed wing, the VTOL types, rover, boat) get one
  `SET_MESSAGE_INTERVAL` per message the app displays (`MESSAGE_RATES_HZ`), which is never
  saved. The rest keep the all-streams request at 4 Hz.
- If the first interval request is refused or unanswered, the firmware predates it and gets the
  all-streams request after all.
- On a link slower than `SLOW_LINK_RTT_MS` the interval rates are halved.
- `sitl.integration.test.ts` checks that connecting to Plane SITL leaves `SR0_*`/`MAV1_*` at 1.

### Slow links (`protocol/link-timing.ts`)

A radio link can answer in seconds where USB answers in milliseconds: ELRS in MAVLink mode at
333 Hz carries about 46 messages a second and answers a request in about 0.5 s, at 150 Hz about
10 messages and 2.5 s. Every request/response client takes its timeout from one `RttEstimator`
(the TCP method, RFC 6298), with its old constant as a floor so fast links behave as before.

- The estimate comes from TIMESYNC (sent on the first heartbeat, then every 2 s; ArduPilot
  echoes `ts1`) and from first-attempt replies to commands and parameter writes. A reply to a
  resend is ambiguous about which send it answers, so it is not sampled.
- Each retry waits twice as long as the one before, capped at 10 s: on a radio a missed reply is
  usually queued behind telemetry, not lost. Replies to earlier attempts are accepted (MAVFTP
  keeps every attempt's sequence number registered until the request settles).
- A parameter download waits up to 3 s for the first measurement before trying MAVFTP, whose
  500 ms floor would otherwise give up on a slow link before it was measured.
- Missing parameters are refetched a few at a time (`REFETCH_WINDOW`), each index on its own
  timeout, rather than a flood of requests that queues behind telemetry.
- `slow-link.integration.test.ts` runs parameters and a mission through `SlowLink`
  (`src/test-fixtures/slow-link.ts`), which models ELRS at 333 Hz: 1.8 kB/s down, latency, loss,
  and the receiver's 1 kB buffer, reported to ArduPilot in RADIO_STATUS so it throttles its
  streams as it would on the real link. Measured: Plane's 1,419 parameters in about 64 s and a
  40-item mission up and back in about 39 s; Copter 74 s and 58 s.

### Airframe banner (`protocol/airframe.ts`)

ArduPilot announces its frame at boot ("QuadPlane Frame: F-35B") to STATUSTEXT and to a MSG log
record, so one matcher serves live view and replay. Match `Frame:` and the name after it: the
surrounding phrase differs between releases, and 4.1.6 writes `Frame: F-35B/`. The value is
latched in `vehicle-store`, because the status feed is a capped ring. The banner is requested
with `MAV_CMD_DO_SEND_BANNER` (42428) on the first heartbeat, since a GCS attaching to a running
vehicle never sees the boot banner (`banner.integration.test.ts`). `KnownAirframe` grows one
aircraft at a time, never by pattern.

### Message inspector (`protocol/engine.ts`, `stores/inspector-store.ts`)

The engine always counts received messages but builds snapshots only while
`setInspecting(true)`, so the store updates at 2.5 Hz regardless of link rate. Rows are keyed
on (sysid, compid, msgid). The GCS's own echoed traffic is shown, which is how a UDP loop is
diagnosed. Only messages in the app's dialect can appear, since MAVLink's CRC covers each
message's definition.

### Sensor device IDs (`protocol/device-id.ts`)

Each detected sensor is stored as a packed `bus_type:3, bus:5, address:8, devtype:8` word
(`INS_ACC_ID`, `COMPASS_DEV_ID`, `BARO1_DEVID`, ...). Devtype tables are per driver class
(0x0B is an ICM20948 compass and an MS5611 barometer), from `AP_HAL/Device.h` and the backend
headers. Zero means nothing found; an unknown devtype keeps its number. Shown in the Inspector
as Hardware ID.

## Parameters

### Source: file or vehicle (`stores/param-store.ts`)

The Parameters screen can open a `.param` file with nothing connected, and `source` records
where the set came from. Write and Reload are disabled while `source` is `'file'`, even after
a vehicle connects: a saved configuration is not the aircraft in front of you, and sending it
by accident is the failure to design against. Revert stays enabled.

### Staging and writing

- Edits stage; nothing reaches the vehicle on a keystroke. Leaving a page with unwritten edits
  prompts (`ui-store`'s `pendingNav`), so each screen owns its own Write: from the card that
  owns the edit (`CardParamActions`), from the actions column, or as the field is used. There
  is no footer Write. The prompt's "Write and continue" catches a write-as-you-go field whose
  write failed.
- `writeNow` is the narrow exception for a parameter that gates other parameters. `OSD_TYPE` is
  the example: at 0 the vehicle reports no panel positions, so the screen stays empty until it
  is written. The field writes, then calls `refreshParams({ quiet: true })` to fetch the newly
  exposed parameters. It never writes on a keystroke (a dropdown writes on change, a number
  field on Enter or blur), and a failed write falls back to staging.
- A quiet refresh skips `beginDownload` (which would blank every curated screen) and calls the
  store's `merged`, not `loaded`, which rebuilds from scratch and would discard staged edits.
  A dirty entry keeps its staged value and updates the vehicle value it is staged against, so
  an edit the vehicle has caught up with stops being an edit.

### Curated screens

Curated tabs are declarations: `ParamCard` takes a field list, drops parameters the vehicle
lacks, and hides itself when empty, so one definition serves Copter, Plane and Rover.
`ParamField`'s `bare` prop drops the label for table layouts.

### Metadata (`services/param-metadata.ts`)

Documentation from the wrong firmware release is worse than none, so metadata is matched to
the vehicle. `AUTOPILOT_VERSION` is requested once per connection (MAV_CMD 520) and the fetch
waits three seconds for it. The version is rounded down to the newest published release that
is not newer. The server has two trees in different formats:

- `/Parameters/ArduCopter/apm.pdef.json`: the current release.
- `/Parameters/versioned/Copter/stable-4.5.7/apm.pdef.xml`: a specific release, with a
  different vehicle spelling.

XML traps: vehicle parameters are prefixed `ArduCopter:` and library ones are bare; a Range is
`"0 10"` in one element; a `<values>` block under a bitmask lists mask values (0, 1, 2, 4)
while the `Bitmask` field lists bit numbers (0, 1, 2), so the `Bitmask` field wins.
`NET=1 npm test` checks the live paths.

## Plans: mission, geofence, rally

### One editor, three plans

Plan mode edits the mission, the geofence and the rally points (`mission-store`'s `editing`).
They differ only by MAVLink's `mission_type`, so they share the map, the transfer client
(`MissionClient`) and the actions column. All three are drawn at once, the inactive two
faded; the switch changes what clicks mean.

- The column is one skeleton: `PlanActions` (read, write, clear, status) and `GeoExchange`
  (import/export) render outside the per-plan panels. The plan's list (shapes or rally points)
  goes last because it is the only section that grows. Offline maps is pinned to the foot.
- Drawing tools live on the map (`ItemPalette`, `FencePalette`, one shared design). Home's
  altitude is edited from its marker's popup, and "use the vehicle's position" is a flyout
  from the palette's Home button, reachable before a home exists. Default altitude and frame
  apply to the next item placed and sit on the item list's header.
- Clearing always asks whether to clear the screen or the vehicle: a fence cleared only on
  screen is still enforced. The vehicle half is `MISSION_CLEAR_ALL` (`services/plan-clear.ts`),
  covered for all three types in `sitl.integration.test.ts`. A refused clear leaves the screen
  unchanged.
- During an upload ArduPilot answers an item it did not ask for with a MISSION_ACK of
  INVALID_SEQUENCE and keeps waiting for the one it wants. On a slow link that is our resend
  crossing its next request, so the client ignores that ack during an upload rather than
  failing the transfer.

### Geofence (`protocol/geofence.ts`)

A polygon is N consecutive wire items whose only boundary marker is the vertex count each
repeats in param1. The vehicle rejects a bad fence with one code that names nothing, so
`validateFence` runs before upload and names the shape.

### Command catalog (`protocol/mission-commands.ts`)

The catalog is hand-written and checked against the firmware, not the spec. `commandsFor`
filters by aircraft: `copterOnly` entries (`NAV_SPLINE_WAYPOINT`, `NAV_PAYLOAD_PLACE`) are
refused by ArduPlane. A connected vehicle decides; otherwise the `planFor` preference does. An
unrecognized `MAV_TYPE` gets the whole catalog.

`mission-commands.integration.test.ts` uploads every command to the SITL vehicle and fails on
any refusal, reading the same `copterOnly` field. Run it against Copter and Plane after changing
the list. Mission storage is not ready at the first heartbeat and answers "No space on
vehicle"; a `DO_JUMP` to item 0 is rejected as invalid. Neither is a catalog error. Check ids
against ArduPilot: 212 is `DO_AUTOTUNE_ENABLE`, and `CONDITION_CHANGE_ALT` is refused by both
vehicles.

### KML and GPX (`services/geo-import.ts`)

An imported shape means whatever plan is on screen: a polygon is a survey area in the mission
and a fence in the fence editor. The only questions asked are ones a file cannot answer
(inclusion or exclusion fence; what to do with a file holding nothing importable).

- Parsing uses DOMParser (hence `services`), matching elements on `localName` so
  `gx:`-prefixed documents work.
- KML is lon,lat; everything else here is lat,lon. A swap still parses.
- `<coordinates>` is comma separated; `gx:coord` is space separated.
- A KML ring repeats its first vertex; a fence does not.
- Imports are Douglas-Peucker simplified to a cap (a GPX track logs a fix per second).
- File elevations are AMSL, used directly only in the AMSL frame; without a surveyed home,
  relative frames use the editor's default altitude.
- A fence exports as a KML `<Polygon>` (GPX cannot express an area), so it imports back as a
  fence.

## Maps and terrain

### Offline map tiles

Offline maps are a cache under the tile layer, not a separate map. `CachedTileLayer`
(`ui/tabs/flight/cached-tile-layer.ts`) overrides `createTile`, and both maps are built through
`createCachedTileLayer`. Network tiles are stored as they load, so panning over a field fills
the cache and the prefetch only fills gaps.

- Revoke a tile's blob URL on `img.onload`, not on tile removal, or tiles leak.
- A prefetch clamps to the layer's `maxNativeZoom`.
- `services/tile-cache.ts` never throws. If the database will not open (private browsing,
  storage denied), maps degrade to plain network fetching.
- Concurrency is six, as a courtesy to public keyless tile servers.
- The coverage overlay (`ui/tabs/flight/coverage-layer.ts`) is a `GridLayer` that shades the
  gaps, not the stored tiles. It uses `hasTile`, which reads the key without loading the blob,
  and takes the base layer's `maxNativeZoom` (past native zoom the stored tile is upscaled).
- Everything that displays cache state subscribes to `subscribeCacheChanges` (coalesced for
  writes, immediate for a clear); the cache is written by panning, the download and the
  terrain loader, and cleared elsewhere.
- The download's outcome message is composed from the returned `PrefetchProgress`, never from
  the request.

### Terrain (`services/terrain.ts`, `services/mission-terrain.ts`)

Elevation comes from Terrarium tiles (PNG, RGB encodes height) from AWS's keyless
`elevation-tiles-prod`, the same SRTM/NED data behind ArduPilot's terrain server. Zoom 12 is
fixed: it matches SRTM's ~38 m resolution, and more zoom resamples the same data at sixteen
times the download. A tile covers about 10 km.

- The mission map prefetches elevation for its settled view (`prefetchTerrainForView`),
  because nothing displays an elevation tile to cache it on the way past. It stays small:
  fixed zoom, stored tiles skipped, one run at a time coalescing to the newest view, paused
  during a manual download.
- Any area is capped at `MAX_AREA_TERRAIN_TILES`, counted before the list is built (the world
  at zoom 12 is 341,598 tiles). An area past the cap returns nothing, not a truncated list.
- MAVLink's three altitude frames are converted to one datum before anything is drawn or
  compared; a terrain-frame 50 and a relative 50 are different heights.
- Clearance is sampled between waypoints, not only at them.
- Terrarium includes bathymetry; `groundLevel` clamps it at zero (which overstates ground in
  below-sea-level basins, the safe direction).
- Sampling is bilinear; nearest-pixel produces a 38 m staircase.

## Units and preferences

### Units at the edge (`src/units.ts`)

Everything inside the app is SI, as MAVLink is. Feet and knots exist only in what a screen
shows and what a keyboard produces: a field converts on the way out and back on the way in,
and the stored number never changes. A round-trip test covers mission altitudes. Climb rate
defaults to `follow` (ft/min when distance is in feet, whatever the airspeed unit), and the
dropdown also offers m/s and ft/min. `resolveVerticalSpeed` is the only place `follow`
becomes a unit. HUD tape steps change with the unit.

### Preferences document (`stores/preferences-store.ts`)

Preferences are one versioned document. Unknown keys are ignored and missing keys fall back,
so adding a preference needs no migration and an older build can read a newer store. Only
reinterpreting an existing key bumps `VERSION`. The dialog is sectioned from the start so it
does not reorganize as it grows. Theme stays in `theme-store` because an inline script applies
it before first paint; the dialog edits it there.

The interface scale (`uiScale`) is Chromium's page zoom, set through the preload's `webFrame`
and applied in `main.tsx` before the first render. Page zoom is used rather than CSS `zoom`
because the map and HUD are canvases that follow the device pixel ratio, which page zoom
changes. Only the offered steps (`UI_SCALES`) are accepted when read back. Layout limits are
CSS pixels and scale with it: 150% on 1920x1080 lays out as 1280x720. In a browser the control
is disabled, since a page cannot set its own zoom.

## Fly screen

### Layout bounds (`.flight-grid` in `app.css`)

Both sizes are bounded, from 1280x720 to 3440x1440. The pinned panel's row is its 4:3 height,
capped to leave room for the flight controls (measured live, since they wrap) and 150px of
lower pane. The left column has a 440px floor on each side of the splitter and stops where
the capped panel fills it, except on a short window (grid under 740px tall), where that stop
falls below the floor and the column follows the drag. The switch keys on height, because the
cap moves with the column width. Context menus place themselves by their measured size.

### Compact layout (`CompactFlight` in `FlightTab.tsx`)

After QGroundControl's Fly view: the map or the video (with the HUD) fills the window and the
other sits in a picture-in-picture inset; a tap on the inset swaps them. It shares
`aspectPanel` with the desktop layout, whose pinned panel is the inset.

- The app bar's readings (`ui/shell/CompactStatus.tsx`) each open a panel (`BarPopover`) with
  the detail: preflight, mode picker, battery, GPS, messages, and the link with Disconnect. The
  logo opens Preferences, which holds the theme.
- There is no actions column. `CommandStrip`, over the bottom center, holds Arm or Disarm and
  Takeoff while armed on the ground; everything else is a mode, picked from the bar. Each is
  confirmed by `SlideConfirm`, which withdraws when its command stops applying, and after 10 s.
  Commands and their reporting are shared with the desktop controls through `useFlightActions`.
- More (top-left) opens `FlightSheet` over the Fly area, leaving the app bar in view: one
  section at a time (Controls, Camera, Video, Joystick, Status, Display). Messages and
  Preflight are left out because the bar's items open them. The map's zoom buttons sit below
  More.
- The HUD's layers are switched from its context menu, which a long press opens on a touch
  screen; its HUD video item opens the sheet's Video view. In the inset the HUD draws no
  overlay, and no horizon either while video plays. Over the full-screen HUD, the inset (or
  the Map button that replaces it when hidden), More and the command row are measured and
  passed as `HudState.avoid`. GPS moves under the link line on the right, the left readings
  stack below More, the speed tape fits above the inset, and the center chips move clear of
  the inset and above the row.

### Lower pane (`LOG_PANES` in `stores/flight-layout-store.ts`)

Messages, Status, Preflight, Camera and Joystick are tabs of one pane. A pane is mounted only
while showing, so anything that must outlive it (the joystick read loop) lives in the app. A
saved pane name is validated on load.

### Takeoff (`takeoffStyle()` in `services/flight.ts`)

Measured against SITL, armed:

- Copter and quadplane: Guided plus `NAV_TAKEOFF` climbs to the requested altitude.
- Fixed wing: `NAV_TAKEOFF` in Guided answers FAILED; takeoff is mode `TAKEOFF` (13), which
  climbs out along the runway to `TKOFF_ALT`.
- `NAV_VTOL_TAKEOFF` is UNSUPPORTED on both plane types.
- A quadplane also accepts mode `TAKEOFF` with MAV_RESULT 0 and flies a runway takeoff, so the
  ack cannot tell the cases apart.

Both plane types report `MAV_TYPE` FIXED_WING, so `takeoffStyle()` reads `Q_ENABLE`, and the
command and button share it. If `Q_ENABLE` is absent (parameters not downloaded), it takes the
quadplane route, which fails harmlessly on a fixed wing.

### Camera and gimbal (`protocol/gimbal.ts`, `services/camera.ts`)

`DO_GIMBAL_MANAGER_PITCHYAW` (1000) is sent from firmware 4.2 on; `DO_MOUNT_CONTROL` (205)
below that or when the version is unknown. 205 is pitch, roll, yaw (yaw in param2 rolls the
camera), and only 1000 carries the earth-frame lock flags. These commands are acked even with
`MNT1_TYPE` at 0, so the MAV_RESULT is verified and reported. UNSUPPORTED on
`IMAGE_START_CAPTURE` falls back to `DO_DIGICAM_CONTROL`. Current firmware denies MOUNT_STATUS
(158) requests and serves GIMBAL_DEVICE_ATTITUDE_STATUS (285). A mount cannot be configured in a
SITL test, because `MNT1_TYPE` needs a reboot and the runner launches with `-w`.

### ADS-B traffic (`protocol/adsb.ts`)

ADSB_VEHICLE carries every field whatever the receiver knows; the flags say which to believe.

- Optional fields are `null` unless flagged. A report without VALID_COORDS is not a target.
  Vertical velocity has its own flag.
- Altitude is in millimeters, heading in centidegrees, velocities in cm/s.
- Identity is the ICAO address, decoded as `ICAOAddress` (not camelCase).
- Unknown is not clear: `isClose` treats a close contact with no altitude as close.
- The map tag shows height relative to this vehicle when there is a fix, otherwise AMSL, and
  `relative` records which.
- Snapshots flush at 1 Hz and targets expire after 15 s. ArduPilot runs its own avoidance
  (`AVD_*`); the GCS decides nothing.

SITL generates traffic only when launched with `--adsb`: its simulated receiver is a
`--serial5 sim:adsb` device whose serial protocol is read at boot. The flag passes a second
defaults file (`--defaults a,b`).

## Joystick (`protocol/joystick.ts`, `services/joystick.ts`, `stores/joystick-store.ts`)

The joystick flies the aircraft. ArduPilot treats RC_CHANNELS_OVERRIDE exactly like a
receiver, so a stuck override is a stuck stick, and the design assumes failure.

### Taking and releasing control

- Control is off at every start and never persisted.
- Each axis has a Centered switch. A centered axis gets the deadzone, expo and the start check
  (`sticksAreSafe`: every centered axis must be centered); an axis that stays where it is left
  gets none. The throttle is not checked, because control taken over in flight is taken at
  hover throttle. A throttle gets no center deadzone.
- Control stops on unplug, when another device takes the chosen one's place, and on link
  loss. Release is in the Joystick pane and on the app bar (`ui/shell/JoystickChip.tsx`) on
  every screen.
- Stopping sends the release, never silence: a vehicle whose override stream stops holds the
  last values until `RC_OVERRIDE_TIME` expires.

Release and "no change" values differ by channel range (MAVLink spec, verified on SITL):

| Channels | No change    | Release |
| -------- | ------------ | ------- |
| 1-8      | 65535        | 0       |
| 9-18     | 0 (or 65535) | 65534   |

Frames are built per channel from `ignoreValue` and `releaseValue`, never from a literal. A
zeros release leaves channels 9-16 held; `sitl.integration.test.ts` checks both halves on
channel 10. An unmapped channel is sent as "no change", never 1500, which would center a
flight-mode switch.

### Buttons

A button is momentary, toggle, set, or flight mode.

- Set: several buttons form one switch, each sending its value from the press on, latched per
  channel.
- Flight mode stores ArduPilot's mode name and resolves it against the connected vehicle when
  pressed (RTL is 6 on Copter, 11 on Plane). An unknown name is reported, not guessed. It acts
  only while the gamepad has control.
- Taking control moves nothing by itself: a toggle starts on the value nearest the vehicle's
  current channel reading, a set channel is untouched until pressed (`initialButtonState`),
  and a button already held is primed rather than counted as a press (`primeButtons`). The
  service re-primes whenever the mapping object changes, since the press Learn captured is
  still held.

### Devices and mappings

- With several input devices attached, nothing is read until the user picks one, remembered
  by device id, never by index. A mapping belongs to a device by the same id; a new device
  starts from the Mode 2 default. Mappings are read-only while control is taken.
- Profiles move as files. Everything from storage or a file goes through `sanitizeConfig`, and
  an import must look like a mapping first, since sanitizing arbitrary JSON yields a valid
  default.
- An empty device list at launch is normal: Chromium hides gamepads until a button is pressed,
  and reports at most four.
- The pane shows live sticks and channel bars; only the Configure dialog edits.

### Out of focus

The pad is read for the whole session from `App`, so leaving the Fly screen or the pane does
not drop control. In the desktop app, taking control turns off background throttling
(`app.setBackgroundThrottling`, restored on release) so the app keeps sending while minimized.
Whether Windows delivers controller input out of focus depends on Chromium's backend: HID
joysticks use RawInput with `RIDEV_INPUTSINK` (background delivery); Xbox-type pads use
Windows.Gaming.Input, which is undocumented for this and untested. Reading them through XInput
in the main process would settle it. In a browser, losing focus releases control; a hidden page
releases in both.

## Video (`services/video.ts`, `electron/video/`)

The desktop app receives H.264 over RTSP or raw RTP/UDP in the main process.

- A stream reconnects by itself and says why it is down (`video-error.ts`). Every failure the
  desktop side reports is followed by a "Stopped"; the first report of an attempt is the one
  acted on, so the error is not wiped. Node's codes are turned into sentences as for the
  vehicle link.
- Anything but a malformed request (bad scheme, not H.264, credentials, 401/403/404) retries at
  1, 2 and 4 seconds, then every 5 seconds until Disconnect. That includes a stream that goes
  silent while playing, since a camera can stop sending without closing its socket.
- The desktop side forwards a source's events only while it is the current source, or a
  stopped stream's "Stopped" would reach the next attempt and read as a drop.

## Setup specifics

### Accelerometer calibration (`protocol/accel-cal.ts`)

An accelerometer calibration cannot be cancelled over MAVLink: `AP_AccelCal::cancel()` is
reached only by arming. `start()` returns immediately (and acks) while a run is in progress,
so a wizard closed mid-run leaves the vehicle waiting and the next PREFLIGHT_CALIBRATION is
ignored. The firmware repeats its request every second as a COMMAND_LONG carrying
`MAV_CMD_ACCELCAL_VEHICLE_POS` with the step in param1, while the matching STATUSTEXT ("Place
vehicle on its LEFT side...") is sent once per side. The wizard follows the command, which lets
it rejoin a run it did not start, and uses the text for wording and the verdict (with a text
fallback). Traps:

- The same command carries a terminal SUCCESS/FAILED that repeats long after a run ends, so the
  wizard tracks arrival time and reads only steps 1-6 for progress.
- The param fields in mavlink-mappings are `_param1` to `_param7`, not `param1`. The encoder
  accepts any key, so the wrong one sends a well-formed request for side zero.
- Sides are walked in order and the step only counts up, so the requested side shows how far
  the run has got.

### OSD grid (`ui/tabs/osd/osd-layout.ts`)

Over MSP DisplayPort, ArduPilot does not clip to `OSDn_TXT_RES`. It writes each panel at its
stored column and row, and the goggles draw what lands on their own canvas, whose size the
vehicle never learns; positions accept columns 0-59 and rows 0-21 whatever the setting says.
A layout made for DJI O3 or Walksnail goggles (53x20, which `TXT_RES` has no value for) often
leaves `TXT_RES` at 0 and works. So `editorGrid` draws the smallest canvas (30x16, 50x18,
53x20, 60x22) that holds every enabled panel, never smaller than the declared grid, and
outlines the declared one. Only an analog OSD, which really is 30x16, reports panels outside
the grid and offers to bring them back.

## MAVFTP, files and logs

### Reading (`protocol/ftp/mavftp.ts`)

A plain MAVFTP read is one round trip per 239 bytes, about 8 kB/s against SITL (24 minutes for
a 10 MB log). `BurstReadFile` reaches about 700 kB/s. Pipelining ordinary reads does not work,
because ArduPilot serves one FTP request at a time. `readFile` tries burst and falls back to
sequential.

- Burst replies do not answer a pending sequence number, so they are routed by `req_opcode`.
- A packet ahead of the contiguous fill point is ignored, not written, or a lost packet leaves
  a hole nothing later fills.
- Cancel returns at once and closes the session behind it (`MavFtpClient.cancelRead`). The
  TerminateSession ack arrives only after the burst in flight (~0.6 s), which is also why the
  next request after a cancel waits about that long. A canceled read never falls back to
  sequential reads and ends quietly.
- ArduPilot paces a burst by its serial port's baud, not the radio's air rate. Behind ELRS
  (460800 baud, about 1.8 kB/s on air) the receiver's buffer overflows and each burst loses all
  but its first few packets, which made a 15 kB `param.pck` take four minutes. Two short bursts
  in a row (`WEAK_BURST_BYTES`) switch the read to sequential requests, resuming where the
  bursts left off.

### Writing (`services/vehicle-files.ts`)

There is no burst write, so uploads run at about 8 kB/s. The Files screen shows the size
before an upload and progress during it, and refuses files over 2 MB (`MAX_UPLOAD_BYTES`).

- Every `WriteFile` carries the session id `CreateFile` returned; session 0 is a different
  session and the writes go nowhere.
- The FTP root is a merged view of the real filesystem and the virtual mounts (`@ROMFS`,
  `@SYS`, `@PARAM`). A file created there never appears in the listing. The screen opens at
  `/APM` on hardware or the SITL working directory, and refuses to upload while the root is
  shown.
- The write path has no fallback, so a SITL integration test creates a directory, writes 1,500
  bytes, reads them back byte for byte, renames and deletes.

### Log download

Hardware keeps logs in `/APM/LOGS`; SITL keeps them in `/logs`. The service probes both.

### Log review and replay

- The 3D replay's attitude mapping is `HeadingPitchRoll(yaw + 90, -pitch, -roll)`. It was
  settled from real logs (the model stays tangent to a straight leg and banks correctly
  through a recorded turn). If it needs revisiting, check it with a log and a screenshot on a
  straight leg, not by deriving it from Cesium's conventions.
- `log-sweep.test.ts` runs the whole log pipeline over a directory of real logs
  (`LOG_SWEEP=<dir> npx vitest run log-sweep.test.ts`). Run it after touching the parser,
  `log-path`, `log-modes` or expressions.

### 3D models (`src/models/`)

The models are Betaflight Configurator's, unmodified, except `f35b.glb`, which is Lofted Aero's
own CAD. Every model follows one convention after glTF import: span on X, nose toward +Y, up
on Z, because both renderers apply the same rotation. Check a new model against the biplane
numerically. The biplane is CC-BY-4.0 and its credit must stay visible in the app (Overview,
under the model), and on the compass-calibration tiles, which are pre-rendered from the models
by `npm run cal-art`. See `src/models/ATTRIBUTION.md`. The quad model is GPL-3.0. Models are
imported with `?url`.

## Firmware

### Manifest (`services/firmware-manifest.ts`)

- Key on `mav-type`, never `vehicletype`, which lumps multirotors and helicopters together.
- `mav-firmware-version-type` has four shapes: `OFFICIAL` (what `/stable/` serves), `BETA`,
  `DEV`, and `STABLE-x.y.z` for every past release, which is what a downgrade needs.
- A `board_id` of 0 means "not stated"; hex/elf/bin rows have none.
- `stable/` and `stable-x.y.z/` list the same build twice. De-duplication must include the
  channel, because beta and stable are cut at the same version number.
- Versions compare numerically per segment. The current release is the one flagged
  `OFFICIAL`, not the top of a sorted list. The fallback runs stable, beta, dev (Blimp has
  only dev builds).

### Identifying a board (`identifyBoard` in `services/flash.ts`)

A board is identified by asking its bootloader (`GET_DEVICE`/`BOARD_ID`) and nothing else: the
generic USB pair `0x1209/0x5741` covers most boards, and the MAVLink link cannot answer. Board id
plus `mav-type` usually yields one platform, chosen outright; `preferredPlatform` prefers the
plain build over suffixed variants (`-bdshot`, `-SimOnHardWare`). A board with no build for the
chosen vehicle falls back to every release it ever had.

- Work the screen starts by itself must not prompt. The automatic probe uses `getPorts()` only
  (`askForPort: false`); `requestPort()` needs a user gesture and shows a chooser.
- The flash reboots the board into its bootloader with `PREFLIGHT_REBOOT_SHUTDOWN` written
  blind down the same port (as `uploader.py` does). The port is acquired once and shared.
- The bootloader is a different USB device that Web Serial's grant does not cover. Take the
  "before" port snapshot after the chooser closes. The browser build polls `getPorts()` and
  listens for `connect` within the ~5 s a click remains a user gesture.
- The desktop shell owns the chooser: `serialPicker.autoPickNew()` makes main hold the request
  until exactly one new port appears (`electron/serial-autopick.ts`), falling back to a live
  chooser. It is armed before the first ask, so a board already in its bootloader needs none.
- A bootloader's product string is the hwdef name plus `-BL`. Electron passes
  `vendorId`/`productId` as decimal strings (`0x1209` is `"4617"`).
- On Windows the old MAVLink port lingers, unopenable, also reporting `-BL`. The driver names
  (`serial-names.ts`) are authoritative: one saying MAVLink or SLCAN vetoes a bootloader
  product string, and a port that arrived during the request outranks a lookalike.
- Flashing while connected is allowed: the reboot goes over the link with a 400 ms ack timeout
  (the vehicle reboots before acking). A cancelled flash sends the bootloader's REBOOT.

### The Firmware screen

The screen is board first, then firmware, and how the board appears decides how it is
flashed: a board answering the ArduPilot bootloader takes an `.apj` over serial; one
enumerating as `0483:DF11` takes a `_with_bl.hex` (bootloader plus firmware) over DFU. DFU is
the normal first install, since a board shipped with Betaflight, INAV or nothing has no
ArduPilot bootloader. DFU has no board id, so its target is picked from the catalog.

- A board identified over serial is left in its bootloader, so Change board and unmounting call
  `bootBoard`. Detecting again releases the previous board only afterwards, and only if the
  new detect found a different one.
- Detecting reboots the board, so it is refused when armed or when MAV_STATE is ACTIVE,
  CRITICAL or EMERGENCY, and confirmed when connected and idle (`FirmwareTab.test.tsx`).
- For a file the user brings, the file decides the path (`.hex` over DFU, `.apj` over serial),
  and a mismatch is explained in terms of the file.
- A `.hex` whose first record is not at `0x08000000` is an app-only image and is refused; over
  DFU it would overwrite the bootloader.
- The state line narrates every step of a flash; it is the one place that verbosity belongs.

### DFU (`protocol/bootloader/dfu.ts`)

Read Betaflight Configurator's `src/js/protocols/usbdfu.js` before changing this code; `toIdle`
is ported from it (GPL-3.0, as this project is).

- Select the alternate setting by name. An STM32 in ROM DFU also exposes `@Option Bytes` (which
  decide whether the chip boots) and `@OTP Memory` (one-time programmable).
- Read the memory layout (`@Internal Flash /0x08000000/16*128Kg`) from the string descriptors;
  Chromium on Windows returns `interfaceName: null` for WinUSB devices.
- There is no board id, and afterwards the board reports whatever id the flashed bootloader was
  built for, so a wrong image looks like success. The only automatic check is the image's top
  address against the flash size.
- `wTransferSize` comes from the DFU functional descriptor (type 0x21); a larger DNLOAD latches
  the STM32 into dfuERROR until a power cycle. Default 1024.
- Always verify: per ST's AN3156, erasing write-protected sectors returns no error.
- `toIdle` picks the request by state: ABORT from dfuDNLOAD_IDLE or dfuUPLOAD_IDLE, CLRSTATUS
  only from dfuERROR, otherwise a bounded poll. The H743 Rev.V dfuDNBUSY wedge is handled
  opt-in via `busyIsStuck`. `leave()` reaches idle first, since a DfuSe command is a DNLOAD.
- Set the address pointer once per segment and let `wBlockNum` (from 2) walk it; each address
  command costs a busy wait.
- Keep the fake in `dfu.test.ts` strict (it stalls what real silicon stalls, and models a
  write-protected board).
- Probe with `getDevices()`; `requestDevice()` only from a user action, after the serial path
  fails. In the shell, `electron/main.ts` answers `select-usb-device` for `0483:DF11` and holds
  an empty request for 2.5 s while Chromium finishes enumerating.

## SITL

SITL (ArduPilot's software-in-the-loop simulator) is the acceptance target. Every protocol
feature is demonstrated against SITL, not only against unit-test fakes.

### Command-line runner (`scripts/sitl.mjs`)

- `npm run sitl:fetch` downloads the prebuilt Windows Copter SITL that Mission Planner uses
  into the gitignored `sitl/` (`-- plane` for Plane).
- `npm run sitl` (or `npm run sitl -- plane`) serves TCP on 127.0.0.1:5760.
- `--home lat,lon[,alt[,yaw]]` (or `SITL_HOME`) boots somewhere other than CMAC; home is read
  at boot. `--adsb [count]` adds simulated ADS-B traffic.
- WSL2 `sim_vehicle.py` works for UDP testing.

Behavior to know:

- SITL accepts one TCP client and exits when it disconnects; the runner relaunches it. Never
  probe the port for readiness; watch stdout for `SERIAL0 on TCP port` (`waitForReady`).
- One runner at a time, enforced by `sitl/.runner.pid` (a dead pid is ignored). Between
  connections the port is briefly free and a second runner would race the first.
- Do not test whether 5760 is free by binding it: Windows allows a second bind over a listening
  socket. The runner gives up after three immediate exits.
- SITL says nothing about a defaults file it could not open. To prove a launch-path change, put
  `SERIAL0_PROTOCOL -1` in it and check that no heartbeat arrives. `SYSID_THISMAV` from a
  defaults file does not reach the heartbeat, so it proves nothing.

### Launching from the desktop app (`electron/sitl-core.ts`)

- A custom executable is identified by reading its version banner (`ArduPlane V4.6.3`) from
  the binary, and gets no stock `--defaults`, which would alter a tuned aircraft.
- The published binaries are cygwin builds needing ten DLLs. A build elsewhere is spawned with
  the managed install on PATH; otherwise it exits with status 0 and no output.
- Stored values outrank `--defaults`, so a parameter file needs `-w` or it is ignored. An
  `eeprom.bin` is the stored set and must not be wiped; SITL reads it only from its working
  directory, so a supplied image is copied in.
- Each model has its own working directory, `<build dir>/<model>/` (Mission Planner's
  convention), so an executable shipped beside `flightaxis/eeprom.bin` finds its parameters.

### RealFlight (FlightAxis)

- `--model flightaxis` talks SOAP on port 18083. RealFlight need not be running first: SITL
  binds its GCS port at once and retries SOAP for its lifetime, but sends no MAVLink until
  FlightAxis exchanges data. The app probes 18083 to warn and to skip a doomed auto-connect,
  never to block the launch. RealFlight's "RealFlight Link enabled" setting (Simulation >
  Settings > Physics) must be on.
- `flightaxis:<host>` is not offered; add it on request.
- `--home` places the whole RealFlight field on Earth (SITL's origin is home, and RealFlight's
  local coordinates are added to it), and its yaw sets the runway heading.
- Home is stored per physics (`sim-store`'s `homes`, keyed by `homeSlot`). An empty slot means
  that physics' default, never written in as though chosen. RealFlight scenery has no geodetic
  reference; the one default is `ELI_FIELD`, RealFlight's default field in Monticello,
  Illinois, used only for FlightAxis.
- Homes are picked on a map (`ui/shell/SimFieldPicker.tsx`), with heading set by rotating an
  arrow over the runway and AMSL altitude looked up from Terrarium tiles. It renders from
  `App`, because the tray closes on any outside click.

## Testing

- `npm test`, `npm run typecheck`, `npm run lint` and `npm run format:check` must all pass; CI
  runs them on push.
- `NET=1 npm test` also runs live checks against ardupilot.org (parameter metadata paths). It
  is the only thing that catches a server path change.
- `SITL=1 npm test` runs the integration suite (`src/protocol/*.integration.test.ts`,
  `electron/sitl-core.test.ts`) against a running `npm run sitl`.
  - Files run one at a time (`fileParallelism` is off when `SITL=1`), because SITL serves one
    client.
  - Every integration test connects through `src/test-fixtures/sitl-client.ts`, which retries
    through the runner's relaunch between files instead of failing on ECONNREFUSED.
  - `SITL_PORT` points the tests at another simulator (for example one started with `-I1` on 5770) when 5760 is in use.
  - `SITL_HOME=... SITL=1 npm test` asserts the vehicle reports being at that home.
  - Run both Copter and Plane. The suite adapts where the vehicles genuinely differ:
    `FRAME_CLASS` is Copter-only (`FORMAT_VERSION` is present on every vehicle); Copter's
    `LOIT_SPEED` corresponds to Plane's `WP_LOITER_RAD`; the flight test is skipped off Copter
    because ArduPlane refuses NAV_TAKEOFF in Guided; the parameter-download time limit (3.5 s)
    allows for Plane's larger set (about 1,420 parameters in about 3 s). Do not assert the
    MAVFTP capability bit.
- `VIDEO=1 npm test` runs `electron/video/source.live.test.ts` against GStreamer:
  - `npm run video:testsrc` serves `rtsp://127.0.0.1:8554/test`; `npm run video:testsrc:udp`
    sends RTP to `127.0.0.1:5600`. GStreamer is not a dependency and appears only in
    `scripts/`; on Windows the script finds the copy inside Mission Planner.
  - Both transports are needed. RTSP interleaves RTP over TCP with no datagram limit, so
    keyframes arrive whole and the FU-A reassembly path never runs; only the UDP source, with
    `mtu=1200`, forces fragmentation.
  - The test pattern is `circular` (about 145 KB a keyframe), because `ball` keyframes fit in
    two packets. `avdec_h264` conceals truncated slices unless `output-corrupt=false` is set.
  - The size assertions are calibrated against measured values. If one fails, check the
    fixture before the client.
- `slow-link.integration.test.ts` (part of `SITL=1`) runs parameters and a mission through an
  ELRS-like link; see [Slow links](#slow-links-protocollink-timingts). It takes about two minutes.
- `electron/sitl-core.test.ts` launches its own simulator on port 5760, so run it with no other
  SITL on that port.
- `LOG_SWEEP=<dir> npx vitest run log-sweep.test.ts` runs the log pipeline over a directory of
  real logs.
- Test fakes should be strict. The MAVLink encoder accepts any field name, so a fake that
  accepts whatever it is sent will pass a misspelled field; features that write to the vehicle
  are proven against SITL.

## Commands

| Command                                              | Purpose                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| `npm run dev`                                        | Browser development server                                     |
| `npm run dev:electron`                               | Desktop development                                            |
| `npm test`                                           | Unit tests (Vitest)                                            |
| `npm run typecheck`                                  | TypeScript, renderer and Electron                              |
| `npm run lint`                                       | ESLint, including the layering rules                           |
| `npm run build:web`                                  | Production web build                                           |
| `npm run build:electron`                             | Production Electron build                                      |
| `npm run dist`                                       | Installers for the current platform only; CI builds all three  |
| `npm run package:web`                                | The web bundle zipped for a static host                        |
| `npm run icon`                                       | Regenerate `build/icon.png` from `public/icons/icon.svg`       |
| `npm run cal-art`                                    | Re-render the compass-calibration sprite sheet from the models |
| `npm run sitl:fetch`, `npm run sitl`                 | Download and run SITL                                          |
| `npm run video:testsrc`, `npm run video:testsrc:udp` | GStreamer video test sources                                   |

## Releasing

`docs/releasing.md` is the runbook. It covers the macOS signing settings (`identity: "-"` and
`hardenedRuntime: false`), why Linux ships a `.deb` beside the AppImage (only the `.deb` can
set up `chrome-sandbox` under Ubuntu 24.04's namespace restrictions), and where `desktopName`
goes in package.json. Nothing is tagged automatically, so the version in package.json is the
only thing distinguishing builds; bump it before every installer run. Preview builds are marked
in-app via `BRAND.preview`, and `docs/preview-testing.md` is the tester-facing companion.

## Language

American English everywhere: code, comments, UI strings and docs. Third-party text keeps its
spelling (the GPL license, dependency names, identifiers from external specs such as
`MAV_RESULT_CANCELLED`).
