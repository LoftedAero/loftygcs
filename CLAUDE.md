# Loft GCS — working notes

Cross-platform ArduPilot ground station. React + TS + Vite renderer shared between a browser
PWA and an Electron shell. Full plan and phase gates: see README roadmap; the authoritative
design decisions are recorded there and in code comments.

## Rules that keep this codebase working

- **Layering** (ESLint-enforced): `src/protocol` is environment-agnostic (no DOM/React/
  Electron/Node imports — it must run in a Web Worker and in plain Node). `src/transport`
  may import from `protocol` (the virtual FC uses the real encoder) but never from
  ui/stores/services. `src/ui` reaches the protocol only through
  `src/worker/worker-client` and the stores.
- **Design system**: `src/styles/lofted-aero.css` is copied verbatim from
  `C:\Users\ericm\Electron_Projects\3BSM_Config\styles\lofted-aero.css` and must stay
  byte-identical — md5 `2f96f253a92dda2da2023d7330c4ea37`. It is shared with 3BSM Config and
  the two sequencer apps, so any change goes into that canonical copy and is propagated to
  all four together, never edited here. (Its DESIGN.md governs usage.) App styles go in `src/styles/app.css`, built
  only from `--la-*` tokens — never a raw hex or pixel gap. The two exceptions are
  *definitions*: the app-local `--app-*` tokens, and the dark palette under
  `:root[data-theme='dark']`, which cannot express a token in terms of itself. **Dark mode is
  an app-local override precisely because the system sheet is frozen** — if it proves out here
  it should graduate into the canonical copy and propagate to all four apps together. Two
  traps it exposed, both worth knowing before touching colors: `--la-charcoal` is both the app
  bar's *background* and heading *ink*, which dark mode needs to send opposite ways (so the
  two text uses are overridden); and anything sitting on a permanently dark ground — the OSD
  preview, a caption over video, white-on-green chips — must use `--app-on-dark`, never
  `--la-surface`, which is only white by coincidence in the light theme. Orange = the one primary action
  per region; blue = working controls; green/red = status only, never actions. Units go in
  `.la-field__unit`; validation goes in `.la-hint` beside the control.
- **Electron security**: contextIsolation + sandbox stay on. The whole privileged surface is
  `electron/preload.ts`, mirrored by `src/types/loftgcs.d.ts` — change them together.
- **Branding**: app identity lives in `src/brand.ts` only ("Loft GCS" is a working name).
- **Navigation** (`src/stores/ui-store.ts`): two levels. Top level is a *mode* — Setup, Fly,
  Mission — switched from the app bar; only Setup has the tab rail, and the others
  (plus a running guide) take the whole window. The rail order is the bring-up sequence, and Ports
  deliberately precedes Sensors because SERIALn_PROTOCOL gates compass/GPS detection.
  The mode switch is never orange: Connect owns the app bar's one primary action.
  **The simulator was a fourth mode and is not one** — it is something you switch on before
  flying or planning, not an activity in itself, so it lives in the app bar's SITL tray
  (`ui/shell/SimTray.tsx`). Its open state is in `ui-store` because other screens send people
  to it. The dot is the part that earns the bar space: a SITL left running in the background
  is otherwise invisible, and the cost of forgetting is a mystery TCP connection or a second
  simulator that will not bind.
- **The actions column** (`.app-col` in `app.css`): every screen that edits something has a
  fixed-width column on the right holding what you *do*, beside the thing you are doing it to.
  Mission, Parameters and OSD share one set of classes so they cannot drift — they each grew a
  private copy first and each picked a different width, which is what the convention exists to
  stop. The rules: width is `var(--app-col-w)`, never a bespoke number; buttons are always
  `size="block"`, one per row (two to a row only fits by shortening labels past the point of
  saying anything); groups are `<section class="app-col__group">` with an `<h3
  class="app-col__head">`; order is what-you-do before what-you-set (vehicle actions, then file
  actions, then settings); and one orange action per column — the one that changes the
  aircraft. Write/Revert/Reload come from `VehicleParamActions`, never re-implemented.
- **Mission mode edits three plans, not one** (`mission-store`'s `editing`): the mission, the
  geofence and the rally points. They share the map, the transfer client and the actions
  column, and differ only by MAVLink's `mission_type` — so there is no second state machine,
  and `MissionClient` was already parameterized for it. All three stay *drawn* whichever is
  selected (the two you are not editing go faint); the switch changes what clicks mean. Two
  things about the fence are easy to get wrong and are handled in `protocol/geofence.ts`: a
  polygon is N consecutive wire items whose only boundary marker is the vertex count each one
  repeats in param1, and the vehicle answers a bad fence with a single error code that names
  nothing — so `validateFence` runs before upload and names the shape itself.
- **Staged parameter edits belong to the page that made them.** Leaving a page with unwritten
  edits prompts (`ui-store`'s `pendingNav`), so a screen's column can own its own Write. The
  global action bar still carries Write for Setup tabs that have no column.
- **Curated tabs** are declarations, not code: `ParamCard` takes a field list, drops params
  the vehicle lacks, and hides itself when empty — so one definition serves Copter, Plane,
  and Rover. `ParamField`'s `bare` prop drops the label for table layouts.
- **Profiles/guides** (`src/profiles/`): product-specific content is strictly opt-in — the
  sole entry point is Setup > "Guided setups…", and labels apply only after explicit
  aircraft selection. New aircraft = a new data module (profile + guide steps), never new
  step-engine code unless a genuinely new step kind is needed. Guides act through
  connectionService (setParamNow/runCommand) so everything stays ack-verified.
- **Encoding**: never round-trip source files through PowerShell Get-Content/Set-Content —
  it mangles UTF-8 (mojibake). Use the Edit/Write tools.
- **The demo vehicle models ArduPilot's rules, but only ones seen on SITL first**
  (`transport/virtual-fc.ts`): it refuses arming and the position modes until a simulated EKF
  settles, refuses NAV_TAKEOFF outside Guided, disarms itself after sitting armed on the
  ground, and sits at the first item when Auto is entered on the ground — each with
  ArduPilot's own wording. Two bugs shipped because it was more permissive than the real
  thing. The entry requirement is narrow on purpose: a rule invented here teaches the app a
  lesson ArduPilot never gives, and tests written against it bake the mistake in. Deliberately
  absent, and to stay absent: flight dynamics (SITL's job), MAVFTP (its absence exercises the
  parameter stream fallback), and the full parameter set. **None of this softens the rule that
  every protocol feature is demonstrated against SITL** — a more convincing demo vehicle makes
  that discipline easier to forget, not less necessary.
- **Log download uses MAVFTP burst reads, and the path matters.** A plain read is a round trip
  per 239 bytes — measured at 28 ms against SITL, so 8 kB/s, or twenty-four minutes for a
  ten-megabyte log. `BurstReadFile` makes that 700 kB/s. Pipelining ordinary reads does *not*
  work: ArduPilot serves one FTP request at a time and times the rest out. `readFile` tries
  burst and falls back to sequential, the same shape as the parameter download's FTP→stream
  fallback. Two traps: burst replies do not answer a pending sequence number, so they are
  routed by `req_opcode` and the seq matcher would drop them; and a packet arriving *ahead* of
  the contiguous fill point must be ignored rather than written, or a lost packet leaves a hole
  in the middle of a log that nothing later fills. Log directories differ — real hardware
  mounts the card at `/APM/LOGS`, SITL has none and keeps them in `/logs` — so the service
  probes both rather than assuming.
- **Launching SITL has three choices, and each hides a trap** (`electron/sitl-core.ts`).
  *Which build*: a custom executable is identified by reading ArduPilot's own
  `ArduPlane V4.6.3` banner out of the binary rather than by asking, because the wrong answer
  launches one vehicle against another's defaults and fails like a broken simulator. Custom
  builds get no stock `--defaults` — layering our bench configuration over an aircraft someone
  tuned would quietly change it. **The published binaries are cygwin builds that need ten DLLs
  beside them, so a build living anywhere else must be spawned with the managed install on
  PATH** (Mission Planner does the same): without it the process exits with status 0 and no
  output at all, which reads as "started and stopped" rather than "a DLL is missing".
  *What it boots with*: `--defaults` only sets defaults and a stored value outranks a default,
  so a parameter file must arrive with `-w` or it is read and silently ignored; an `eeprom.bin`
  is the stored set itself and must **not** be wiped. SITL has no option to read storage from
  elsewhere — it opens `eeprom.bin` in its working directory — so a supplied image is copied
  in, leaving the distributed file untouched while the working copy accumulates changes.
  *Where state lives*: one working directory per model, `<build dir>/<model>/`, which is
  Mission Planner's convention and the shape an aircraft ships in — an executable beside a
  `flightaxis/eeprom.bin`, so pointing at the executable finds the parameters with no further
  instruction. The FlightAxis host is dropped from that name (a colon cannot be a Windows
  directory, and it is the same aircraft whichever machine draws it).
- **RealFlight is reached by `--model flightaxis[:host]`** over SOAP on port 18083, and it does
  *not* have to be running first. SITL binds its GCS port and prints its readiness banner in
  about 40 ms either way, and ArduPilot's `socket_creator` thread retries the SOAP connection
  for as long as the process lives — so "start the simulator, then start RealFlight" is a
  supported order and the app must not refuse it. What SITL will not do is send any MAVLink
  until FlightAxis is exchanging data (`update()` returns early with no sample), so a GCS
  attaches to a silent port and times out. The app therefore probes 18083 to *warn* and to skip
  an auto-connect that cannot succeed, never to block the launch. The setting people forget is
  Simulation > Settings > Physics > "RealFlight Link enabled".
- **With FlightAxis, `--home` places the whole RealFlight field on Earth.** `SIM_Aircraft` sets
  `origin = home`, and FlightAxis adds RealFlight's local coordinates to it, so home decides
  both where the scenery sits and — through the yaw — which way its runway points. That is why
  saved flying fields carry a heading. RealFlight itself has no geodetic reference: its content
  archives contain no latitude or longitude at all, so those numbers can only come from the
  user, and none may be shipped pre-filled.
- **SITL says nothing about a defaults file it could not open** — not for a missing file, not
  for a bad path. Do not look for an error; there is none. When a launch-path change needs
  proving, the probe that works is `SERIAL0_PROTOCOL -1`, which switches MAVLink off: "did a
  heartbeat arrive" is binary, needs no MAVLink parsing, and cannot pass for the wrong reason.
  `SYSID_THISMAV` looks like the obvious marker and is not — it does not reach the heartbeat
  from a defaults file, so a test built on it can only ever pass.
- **The inspector is the one place raw traffic reaches React state, and only because it is not
  raw** (`protocol/engine.ts` + `stores/inspector-store.ts`). The engine counts every received
  message always — one map upsert beside a decode that already happened — but builds snapshots
  only while `setInspecting(true)`, so the store updates at 2.5 Hz however hard the link runs.
  Rows are keyed on (sysid, compid, msgid), not msgid alone: a gimbal's ATTITUDE and the
  autopilot's are different conversations, and the inspector deliberately shows the GCS's own
  echoed traffic that the vehicle logic drops, because seeing your own heartbeat come back is
  how a UDP loop gets diagnosed. Only messages in this app's dialect can ever appear — MAVLink
  folds each message's definition into its CRC, so an unknown msgid cannot survive framing.
- **Units convert at the edge and nowhere else** (`src/units.ts`, `stores/preferences-store.ts`).
  Everything inside the app is SI because MAVLink is; feet and knots exist only in what a screen
  shows and what a keyboard just produced. A field that displays a stored value converts on the
  way out and back on the way in, and the stored number never moves — a units bug that reaches a
  mission altitude is a flying-into-terrain bug, which is why there is a round-trip test for
  exactly that. Climb rate has no control of its own: aviation reads it in ft/min wherever
  distance is in feet, whatever the airspeed unit, so it follows the distance choice. HUD tape
  steps change with the unit too, or the imperial tape scrolls three times too fast to read.
- **User preferences are one versioned document, not a key per setting** (`preferences-store`).
  Unknown keys are ignored and missing ones fall back, so adding a preference needs no migration
  and an older build reading a newer store still works; only *reinterpreting* an existing key
  bumps VERSION. The dialog is sectioned for the same reason — language is a section, and a flat
  list that grows into groups later reorganizes under the user. Theme stays in `theme-store`
  because it must be applied before first paint by an inline script; the dialog edits it there.
- **Offline maps are a cache under the tile layer, not a separate map.** Leaflet's `TileLayer`
  sets `img.src` and lets the browser fetch, which leaves nowhere to consult a store — so
  `CachedTileLayer` overrides `createTile` (`ui/tabs/flight/cached-tile-layer.ts`) and both maps
  are built through `createCachedTileLayer`. A network tile is stored on the way past, so
  panning the field before takeoff fills the cache for free and the prefetch button only has
  gaps left to fill. Three things it is easy to get wrong: the blob URL is revoked on
  `img.onload`, not on tile removal, or every tile leaks for the session; a prefetch must clamp
  to the layer's `maxNativeZoom`, since asking for three levels past what the server has
  downloads three levels of nothing; and `services/tile-cache.ts` never throws — a database
  that will not open (private browsing, storage denied) has to degrade to plain network
  fetching rather than break a map someone is flying with. Concurrency stays at six because
  these are public tile servers used keyless, and courtesy is the condition of that. **"Will
  this work when I get there" has no honest answer from a tile count** — a cache can hold five
  thousand tiles of the wrong valley — so the coverage overlay is a `GridLayer`
  (`ui/tabs/flight/coverage-layer.ts`) drawing Leaflet's own squares, and it shades the *gaps*:
  hatching what is already stored would obscure the map in order to say it is fine. It asks
  `hasTile`, which reads the key and never materializes the blob, because it asks about every
  square on screen at once.
- **Terrain is a raster, and the datum is the part to get right.** Ground elevation comes from
  Terrarium tiles (`services/terrain.ts`) — an ordinary PNG whose RGB encodes one height, from
  AWS's keyless `elevation-tiles-prod`, which is the same SRTM/NED data ArduPilot's own terrain
  server is built from. Zoom 12 is deliberate: that is SRTM's own ~38 m resolution, and more
  zoom resamples the same measurements while downloading sixteen times as much. One tile covers
  about ten kilometers, so a field is one or two and the offline download brings terrain along
  for nothing. Three traps, all in `services/mission-terrain.ts` with tests: MAVLink's three
  altitude frames have to be converted to one datum before anything is drawn or compared — a
  terrain-frame 50 and a relative 50 are different heights, and drawing them at the same place
  hides exactly the mistake a profile exists to catch; clearance must be sampled *between*
  waypoints, since two waypoints at 100 m with a 140 m hill between them are each individually
  fine; and Terrarium carries bathymetry, so an offshore leg reads the sea floor four kilometers
  down unless it is pulled up to zero (`groundLevel`), which also overstates the ground in Death
  Valley — the safe direction. Sampling is bilinear because nearest-pixel puts a 38 m staircase
  in the profile and reads as cliffs on a slope. **Any area handed to the terrain code is capped
  at `MAX_AREA_TERRAIN_TILES`**, and the count is taken before the list is built: the world at
  zoom 12 is 341,598 tiles, which is what Mission mode shows before anyone touches the map, and
  without the cap opening it asked the cache about every terrain tile on Earth — starving every
  other read on the page — and offered to download thirty gigabytes of them. An area past the
  cap returns *nothing* rather than a truncated list, because half a terrain profile is a hole
  nothing explains.
- **An imported shape means whatever plan is on screen.** KML and GPX come in through
  `services/geo-import.ts`, and the destination is decided by `editing`, not by the shape: the
  same polygon is a survey area while planning a mission and a geofence while editing the
  fence, and a line is a route in one and a boundary in the other. That is the rule Mission
  mode already follows, and it removes a dialog that would ask a question the screen has
  answered — only a file holding *several* shapes gets a picker. Parsing lives in `services`
  rather than `protocol` because it needs DOMParser, and a regular expression over KML finds
  CDATA, entities and namespaces one bug report at a time; elements are matched on `localName`
  so `gx:`-prefixed documents work. Three things bite: KML is **lon,lat** and everything else
  here is lat,lon (a swap still parses, and puts a Colorado mission in the Indian Ocean);
  `<coordinates>` is comma separated while `gx:coord` in the same file is space separated; and
  a KML ring repeats its first vertex where a fence does not. Every import is Douglas-Peucker
  simplified to a cap — a GPX track is a fix a second, and 3,600 waypoints is a way of not
  importing it at all. A file's elevation is always AMSL, so it is only used directly in the
  AMSL frame; converting it to a relative one needs a surveyed home, and without one the
  editor's default altitude is used rather than a guess.
- **Writing over MAVFTP is nothing like reading it.** There is no burst *write*, and ArduPilot
  serves one FTP request at a time, so a file goes up at 239 bytes a round trip — about 8 kB/s
  against the 700 kB/s a burst read manages, which is why the Files screen shows the size
  before an upload and a progress bar during it, and why anything over a couple of megabytes is
  refused rather than attempted. Two things learned from SITL rather than guessed: every
  `WriteFile` must carry the session `CreateFile` handed back (zero is a different session and
  the writes go nowhere), and **the FTP root is not an ordinary directory** — it is a merged
  view of the real filesystem and the virtual mounts (`@ROMFS`, `@SYS`, `@PARAM`), and a file
  created there never comes back in the listing. So `services/vehicle-files.ts` opens at `/APM`
  (hardware) or the SITL working directory, and the screen refuses to upload while the root is
  showing rather than offering a transfer that silently does nothing. The write path has no
  fallback to hide a mistake, so it is covered by a SITL integration test that creates a
  directory, writes 1,500 bytes, reads them back byte for byte, renames and deletes.
- **Parameter metadata is matched to the firmware, and the two published forms differ.**
  Documentation from the wrong release is worse than none — a range or a bitmask that looks
  authoritative and is wrong — so `services/param-metadata.ts` asks the vehicle what it is
  first. AUTOPILOT_VERSION is requested once per connection (MAV_CMD 520) and the metadata
  fetch waits three seconds for the answer before falling back. The server's two trees do not
  match: `/Parameters/ArduCopter/apm.pdef.json` is the current release, while
  `/Parameters/versioned/Copter/stable-4.5.7/apm.pdef.xml` is a specific one — different
  vehicle spelling, different format, one form each. So both readers live in that file, and the
  XML has its own traps: names are prefixed `ArduCopter:` for vehicle parameters and bare for
  library ones, a Range is `"0 10"` in one element rather than two attributes, and a `<values>`
  block under a bitmask parameter lists *mask* values (0,1,2,4) where the `Bitmask` field lists
  *bits* (0,1,2) — so the field wins whenever both are present. The version is rounded *down*
  to the newest published release that is not newer. `NET=1 npm test` runs the live check
  against the real server, which is the only thing that catches a path change.
- **Which mount protocol to send depends on the firmware, and the answer codes matter.**
  ArduPilot carries three generations and answers all of them, so `protocol/gimbal.ts` picks by
  version: DO_GIMBAL_MANAGER_PITCHYAW (1000) from 4.2 on, DO_MOUNT_CONTROL (205) below it and
  when the vehicle never said. They are not interchangeable — 205 is pitch, *roll*, yaw, so yaw
  in param2 rolls the camera instead of turning it, and only the newer one carries the lock
  flags that decide whether the camera holds an earth heading or follows the nose. Every one of
  these commands is answered even with `MNT1_TYPE` at zero, and the MAV_RESULT is the only
  difference between "pointed" and "no mount configured" — so `services/camera.ts` verifies the
  ack and reports it, and treats UNSUPPORTED on IMAGE_START_CAPTURE as the cue to fall back to
  ArduPilot's own DO_DIGICAM_CONTROL trigger. Two things measured against SITL: current
  firmware DENIES a request for MOUNT_STATUS (158) and accepts one for
  GIMBAL_DEVICE_ATTITUDE_STATUS (285), which is why the modern decode is the one that matters;
  and a mount cannot be configured in a SITL test at all, because `MNT1_TYPE` needs a reboot
  and the runner launches with `-w` and a defaults file, so nothing survives one.
- **The joystick is the one feature that can fly the aircraft, so it is built around failure.**
  ArduPilot reads RC_CHANNELS_OVERRIDE exactly as it reads a receiver — there is no separate
  simulated path, and a stuck override is a stuck stick. Hence: it is off at every start and
  nothing persists it; it refuses to start unless the sticks are centered and the throttle is
  down (`sticksAreSafe`, because the pad is usually on a desk under something); and it stops
  itself on window blur, tab hide, unplug and link loss. The rule that is easiest to get wrong
  is that **stopping means sending zeros, not going quiet** — a vehicle whose override stream
  stops holds the last value until its own RC failsafe notices, so `RELEASE` is sent three
  times over. Two more: an unmapped channel goes out as 65535 ("no change"), never as 1500,
  because centering an unmapped channel drives a flight-mode switch to its middle position; and
  a throttle gets no center deadzone, which would be a dead patch mid-travel. **With more than
  one input device attached, nothing is read until someone says which** — a wheel, a HOTAS and
  a gamepad on the same desk all appear in `getGamepads()`, and taking the first is taking
  whichever the browser happened to enumerate, which on this feature means the sticks are
  somewhere other than where the screen says they are. The choice is remembered by the device's
  reported *id*, never its index: indices shuffle between sessions, so a remembered index is a
  remembered different device. Proven against
  SITL both ways — the override reaches the vehicle's RC_CHANNELS *and* the release hands them
  back — because the encoder accepts any field name and a wrong one produces a well-formed
  message full of zeros that a fake would happily accept.
- **High-rate telemetry** never goes through React state — ring buffers + rAF reads
  (arrives in Phase 1).
- **American English** everywhere — code, comments, UI strings, docs (color, behavior,
  centered, labeled, canceled, -ize verbs). Third-party text is the exception and stays
  verbatim: the GPL LICENSE, dependency names, and identifiers from external specs (MAVLink's
  own `MAV_RESULT_CANCELLED` keeps its spelling; only our rendered label is Americanized).
- **The replay's attitude mapping is settled empirically, never by reasoning, and it is now
  settled.** `HeadingPitchRoll(yaw + 90, -pitch, -roll)` is correct: on a 346-sample straight
  leg the model sits tangent to its own track, and it banks the right way through a turn the
  log records as +65 degrees of right roll at 31 deg/s. Three separate attempts to *derive*
  that transform from Cesium's conventions reached three different wrong answers, the last
  "proving" the nose points straight down — so if it ever needs revisiting, revisit it with a
  log and a screenshot, not with a whiteboard. Pick a *straight* leg for heading: at a
  figure-eight crossing the local track direction is ambiguous and the picture proves nothing.
- **`log-sweep.test.ts` runs the whole log pipeline over a directory of real logs**
  (`LOG_SWEEP=<dir> npx vitest run log-sweep.test.ts`). It found the bug a single fixture never
  could: ArduPlane 4.1.6 writes `Frame: F-35B/` — the frame *class* with an empty type — where
  4.2.2 writes `Frame: F-35B`, so an exact match missed nine of one aircraft's own logs. Point
  it at any log collection after touching the parser, `log-path`, `log-modes` or expressions.

- **The vehicle draws itself when it says what it is** (`protocol/airframe.ts`). ArduPilot
  announces its frame at boot -- "QuadPlane Frame: F-35B" -- to both STATUSTEXT and a MSG
  record, so one matcher serves the live view and the log replay. Match `Frame:` and the name
  after it, never the surrounding phrase: 4.2.2 writes "QuadPlane Frame: F-35B" and 4.6.3
  writes "QuadPlane initialised, Frame: F-35B", so matching the current wording would miss
  every log that already exists. The live value is *latched* in `vehicle-store` as the banner
  goes past, because the status feed is a capped ring the line scrolls out of. `KnownAirframe`
  grows one aircraft at a time and never by pattern: each entry needs a model this repo may
  ship, and a loose matcher would put the wrong aeroplane on someone else's screen.

- **3D models** (`src/models/`) are Betaflight Configurator's, unmodified, except `f35b.glb`,
  which is Lofted Aero's own CAD (STEP -> FreeCAD tessellation -> Blender decimate to ~5k
  triangles -> GLB) and so needs no in-app credit. Every model is authored to one convention
  -- span on X, nose toward +Y, up on Z, once a glTF importer has flattened it -- because both
  renderers apply the same rotation to whatever they load; check a new one against the biplane
  numerically rather than by eye. The biplane is
  CC-BY-4.0 and its credit must stay visible in the app (Overview, under the model), not just
  in the repo — see `src/models/ATTRIBUTION.md`. The quad is GPL-3.0, usable only because this
  app is GPL-3.0. Imported with `?url`; the demo build inlines them via `assetsInlineLimit`.
- Comments say *why*, not what.

## Commands

- `npm run dev` / `npm run dev:electron` — browser / desktop development
- `npm test`, `npm run typecheck`, `npm run lint` — all three must pass; CI runs them on push
- `NET=1 npm test` — also runs the live checks against ardupilot.org (parameter metadata paths)
- `npm run dist` — installers for *this* platform only; all three come from CI
- `npm run package:web` — the web bundle zipped for a static host
- `npm run icon` — regenerate `build/icon.png` from `public/icons/icon.svg`
- `npm run build:demo` — the single-file shareable demo

## Shipping

**`docs/releasing.md` is the runbook — follow it rather than reconstructing it.**
It carries the things that are expensive to rediscover: why macOS `identity: "-"` and
`hardenedRuntime: false` are load-bearing (arm64 will not execute unsigned, and hardened
runtime rejects the pre-signed Electron framework), why Linux ships a `.deb` as well as an
AppImage (only the `.deb` can fix up `chrome-sandbox` for Ubuntu 24.04's namespace
restrictions), and that `desktopName` belongs at the *top level* of package.json.

The installer matrix is **manual only** (Actions → CI → Run workflow) while the repo is
private, because macOS bills at 10x. Nothing is tagged automatically, so **the version in
package.json is the only thing distinguishing one build from another** — bump it before every
run. `docs/preview-testing.md` is the tester-facing companion and ships with the downloads.
Preview builds are marked in-app via `BRAND.preview`.

## SITL (the acceptance target from Phase 1 on)

`npm run sitl:fetch` once (downloads the prebuilt Windows ArduCopter SITL that Mission
Planner uses, into gitignored `sitl/`), then `npm run sitl` to start it — it serves TCP on
127.0.0.1:5760 and waits for a GCS. `npm run sitl -- --home 38.9034,-77.0365` (or `SITL_HOME`)
boots it at your own field instead of CMAC, so a mission planned on the map can be flown
without dragging every waypoint to Canberra; the desktop app's Simulator card has the same
field. Home is read at boot, so changing it means restarting. `SITL_HOME=... SITL=1 npm test`
then asserts the vehicle really reports being there. **Do not check whether 5760 is free by
binding it** — Windows lets a second bind succeed over a listening socket, so the probe says
"free" and you end up talking to the *previous* simulator at its own home; the runner instead
gives up after three immediate exits and says so. `SITL=1 npm test` runs the integration suite against
it (`src/protocol/*.integration.test.ts`, `electron/sitl-core.test.ts`). The desktop app can
also install and run SITL itself — the app bar's SITL tray (`electron/sitl-core.ts`).

## Video test source

Same discipline as SITL, for the HUD video path: our own fake RTSP server can only confirm
what we already believe, so the client is also run against GStreamer, which makes none of our
assumptions.

`npm run video:testsrc` serves `rtsp://127.0.0.1:8554/test`; `npm run video:testsrc:udp` sends
RTP to `127.0.0.1:5600`. Then `VIDEO=1 npm test` runs `electron/video/source.live.test.ts`
(skipped otherwise). GStreamer is *not* a dependency — it is the thing we replaced, and it
appears only in `scripts/`. On Windows it is usually already present inside Mission Planner,
which is where the script looks.

**Both transports are needed, and this is not obvious.** RTP interleaved over RTSP's TCP
socket has no datagram limit, so GStreamer sends each keyframe whole and the FU-A reassembly
path never executes — the RTSP tests stayed green against a depayloader deliberately broken to
drop fragments. Only the UDP source, with `mtu=1200`, forces fragmentation. Two further traps
found the same way: `videotestsrc pattern=ball` encodes so small that keyframes fit in two
packets (hence `circular`, ~145 KB a keyframe), and `avdec_h264` conceals a truncated slice and
still emits a frame, so the decoded frame count matches unless `output-corrupt=false` is set.
The size assertions there are calibrated against measured values, not guessed — if one fails,
suspect the fixture went slack before suspecting the client.

**SITL gotcha that bit us twice:** it accepts exactly one TCP client and exits the moment that
client disconnects, so never probe the port to check readiness — watch stdout for the
`SERIAL0 on TCP port` banner instead (`waitForReady`). Every protocol feature must be demonstrated
against SITL before its phase closes — never trust the virtual FC alone. WSL2
`sim_vehicle.py` works too for UDP testing.
