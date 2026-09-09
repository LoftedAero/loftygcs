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
  it should graduate into the canonical copy and propagate to all four apps together. Four
  traps it exposed, all worth knowing before touching colors. `--la-charcoal` is both the app
  bar's *background* and heading *ink*, which dark mode needs to send opposite ways (so the
  two text uses are overridden); and anything sitting on a permanently dark ground — the OSD
  preview, a caption over video, white-on-green chips — must use `--app-on-dark`, never
  `--la-surface`, which is only white by coincidence in the light theme. **A color baked into
  a data URI cannot follow a token**: the chevron on `.la-select` is an inlined SVG whose fill
  lives inside the URI, so it kept a light-mode gray arrow on a dark field until it was
  re-inlined under the dark block — which means `--la-ink-2`'s dark value is now spelled out
  in one place and nothing keeps the two in step. It is the one color in `app.css` that
  *duplicates* a token rather than defining a new one, and the technique that removes it (here
  and in the light theme, and in the three sequencer apps carrying the same hex) is a
  `mask-image` plus `background-color`, which is the thing to reach for if this graduates.
  **And a `<select>`'s dropdown is drawn by the platform, which does not reliably honor
  `color-scheme`** — on Windows the list comes up white on a dark window. The sheet's only
  option rule is `.la-appbar .la-select option`, which sets `color` and no background, so in
  dark the app bar's dropdown went near-white on white and read as blank rows — everything
  below it was fine, because nothing colored those options at all. The fix is deliberately
  wider than the bug: both halves are pinned on `.la-select option` for every select, so a
  dark window stops throwing white popups, and it is unscoped rather than dark-only because
  the same failure happens inverted on a dark OS showing a light window. Orange = the one primary action
  per region; blue = working controls; green/red = status only, never actions. Units go in
  `.la-field__unit`; validation goes in `.la-hint` beside the control. **Hints are short.** A
  `.la-hint` says the one thing someone needs at the moment they read it — not why the
  protocol works that way, not what the alternative would have been. The reasoning belongs in a
  comment, where it costs the reader nothing; on screen it is noise that trains people to skip
  the line that does matter.
- **A renderer reload leaks whatever the main process is holding for it.** Link sockets and the
  video receiver live in the main process and are closed one at a time by the renderer that
  opened them, so a reload throws away the ids and the sockets stay open — and a *bound* one (a
  UDP link, the video port) then refuses the next connection with EADDRINUSE on a machine where
  nothing appears to be running. `main.ts` therefore drops that state on
  `did-start-loading` and `render-process-gone` as well as on quit. The simulator is
  deliberately exempt: it is a separate process serving a port, not renderer state, and
  reloading the window is not a reason to end a flight.

- **Electron security**: contextIsolation + sandbox stay on. The whole privileged surface is
  `electron/preload.ts`, mirrored by `src/types/loftgcs.d.ts` — change them together.
- **Branding**: app identity lives in `src/brand.ts` only ("Loft GCS" is a working name).
- **Navigation** (`src/stores/ui-store.ts`): two levels. Top level is a *mode* — Fly, Mission,
  Setup — switched from the app bar; only Setup has the tab rail, and the others
  (plus a running guide) take the whole window. **The app opens on Fly, and Fly draws with or
  without a vehicle.** It used to be a card describing what the screen would have shown, which
  meant the app opened on a description of itself; the map is worth looking at before anything is
  connected, and the instruments reading zero is what an instrument does when nothing is driving
  it. What makes that safe is that everything commanding the aircraft is already gated on
  `connected` in `FlightControls` — App.test.tsx pins that, because it is the property the
  decision rests on. Setup is last, which is Mission Planner's order and the order the work
  happens in. Ports deliberately precedes Sensors, because
  **SERIALn_PROTOCOL gates compass/GPS detection**: a board whose ports are unconfigured will not
  find an external compass, and calibrating one the firmware never saw is the classic dead end.
  The order is the only thing that warns about it.
  The mode switch is never orange: Connect owns the app bar's one primary action.
  **The rail is grouped in three** — Initial Setup, Config/Tuning, Data — leaning on Mission
  Planner's vocabulary because anyone arriving here has almost certainly used it. Its
  Mandatory/Optional split is deliberately *not* carried over: that distinction belongs to the
  airframe rather than the screen (a battery monitor is optional until the vehicle has one, at
  which point setting it up is not), and a label that is wrong half the time teaches people to
  stop reading labels. The headings come from a `group` field on `TABS` rather than a second
  structure, so a tab cannot land in a group the rail does not draw. Order still carries meaning
  *inside* a group: Initial Setup runs as a bring-up runs.
  **The simulator was a fourth mode and is not one** — it is something you switch on before
  flying or planning, not an activity in itself, so it lives in the app bar's SITL tray
  (`ui/shell/SimTray.tsx`). Its open state is in `ui-store` because other screens send people
  to it. The dot is the part that earns the bar space: a SITL left running in the background
  is otherwise invisible, and the cost of forgetting is a mystery TCP connection or a second
  simulator that will not bind.
- **`docs/ui-conventions.md` is the layer above the design system**: how screens in *this* app
  are put together, as opposed to what a button looks like. Every rule in it is kept with the
  feedback that produced it, so a rule can be argued with and a wrong one can be found — add to
  it when a review produces a preference that will apply again, and leave anything that applies
  to one screen only in a comment there. `docs/screen-review.md` is the per-screen gate those
  conventions are checked against before a preview build.
- **The app bar is a three-track grid, not a flex row, and only the middle track may change
  size.** Left is what the app is — brand, the mode switch, the SITL tray, preferences; right is
  the link — transport, Connect, Disconnect; the vehicle status sits between them. The outer two
  are anchored so nothing a status can do ever moves a control someone is reaching for.
  **Spacers cannot do this job, for two separate reasons.** The first is geometric: a pair of
  spacers centers the middle band between the two groups, and these groups differ by about
  230px, so the status sat visibly right of the window's midline — `1fr auto 1fr` puts it *on*
  the midline (measured at 0px off center from 1440 to 3440) and, because a `1fr` track is
  `minmax(auto, 1fr)`, gives way rather than overlapping when a side band outgrows its share.
  The second is a trap in the system sheet: `.la-appbar__spacer` is declared `flex: 1 1 auto`
  and then disabled twelve lines later by `.la-appbar > * { flex: none }` — same sheet, higher
  specificity, later in the cascade — **so the sheet's own spacer has never sprung**, and the
  bar's only flexible child was `.la-appbar .la-readout--wide` at (0,2,0). That quietly made the
  readout load-bearing for the *layout* as well as the status, which is why taking it out let
  the connection controls slide with whatever the status said. There are now no spacers in this
  bar at all.
- **The app bar reports the vehicle as indicators, and draws none of them when
  there is nothing to report** (`ui/shell/AppStatus.tsx` + `app-status.ts`). It held a
  `.la-readout--wide` inherited from the other Lofted Aero apps, where that element is the
  app's own main live value and `flex: 1 1 auto` is right. Here it carried
  `Name · Mode · Armed` and still absorbed every spare pixel — measured at 691px in a 1600px
  window and 1651px at 2560, against a longest-ever string of 203px — while saying the wrong
  things: mode and armed state are also in the flight controls, and battery, GPS, link and
  prearm were drawn *only* on the HUD canvas, behind an overlays toggle, on one screen out of
  three. **Nothing in a bar may absorb the window's slack**, and room is made by dropping whole
  items at a breakpoint rather than letting them squeeze: a clipped `15.9V 24.1A 61%` is a
  wrong reading, not a short one, so `.app-status__item` is `flex: none` and the breakpoints
  (1500px for the readings, 1080px for the word) were measured against the *longest* strings a
  real vehicle produces — the readings' moved up from 1400 the moment the bands stopped being
  allowed to shrink under their own content, which is a second trap: **`min-width: 0` on a grid
  band lets its `1fr` track shrink under its content**, and the side bands then ran into the
  centered status between 1410px and 1700px rather than pushing it aside. Leave the auto minimum
  alone and the grid gives the space up from the middle, which is the graceful failure this
  layout is meant to have. **The three gauges share one slot width**
  (`--app-status-slot-w`), which puts their icons on a constant 128px pitch — sized to their own
  worst cases they came out 152/116/170 and the row read as items scattered at uneven distances.
  The mode is exempt: it is last and has only a floor, because its length is set by firmware
  rather than by this app, so it is allowed to grow off the end of the row instead of shoving
  four gauges sideways. Two things paid for the equal slot: the bar formats its *own* battery and
  link strings (pack current and the packet rate move to the tooltip), because carrying the HUD's
  full versions would have needed 148px a slot; and **a filled shape is read by its edge, not by
  where its text ends** — the state pill's edge sat 20px from the first icon while the gauges
  were 37px apart, so it looked shoved against them even though the gap from its *text* was the
  widest in the row. Measuring the wrong thing is how that goes unnoticed. — measured, and named in the CSS beside each — so a value
  changing never drags its neighbours sideways, and the chip's `min-width` covers every state
  that can appear beside the readings, which makes the whole row one constant width for as long
  as a vehicle is connected. Per-slot rather than one shared width, unlike a *column* of
  controls: four equal slots would have to match the widest, total 576px and overflow a 1600px
  bar, where these total 484px — and the alignment a shared width buys is vertical, which a row
  has none of. **The readings are labelled by icon, and the icons are drawn here** (the app bar's
  gear already was): three glyphs is not a reason to take on an icon set, and they have to take
  `currentColor` so a warning tone reaches them on a permanently dark ground. GPS is a *globe*
  rather than the conventional satellite because three attempts at a satellite — dish on a mast,
  dish with a feed horn, body with solar panels — were all illegible at 16px, which is the only
  size they are ever drawn at; they were fine at 96px, and that is not the test. Check a new one
  by rendering it at the size it will be used — and 20px, not 16: at 16 the battery's fill and
  the signal's lit-bar count, which are the whole reason they are pictures rather than words,
  were not legible on a 52px bar. **With no vehicle the row is not drawn at all** — the component
  returns null, the way QGroundControl instantiates no vehicle indicators without a vehicle and
  Betaflight sets its cluster to `display: none`; neither has an element reading "not
  connected". **Inside a connected vehicle, though, the set of readings is fixed.** They were
  first gated on SYS_STATUS's present mask too, which meant a flight controller with no GPS had
  no GPS reading — telling a pilot nothing, reading as a layout fault, and hiding the fact that
  decides whether the position modes can be flown. "No GPS" is a reading; Betaflight draws all
  six of its sensor cells for the same reason, and a fixed set also makes the row one shape
  across every aircraft. What survives from the stricter rule is that a *value* the vehicle
  never gave is a dash, never a zero: `0.0V` is both "no monitor fitted" and "a monitor reading
  a dead pack", and `battery_remaining` of -1 draws an empty cell rather than a flat one.
  **Color comes from the vehicle's own thresholds or not at all** — `BATT_LOW_VOLT` and
  `BATT_CRT_VOLT` for the pack, ArduPilot's own 3D-fix gate for GPS — because a threshold
  invented here would put this app's opinion on the bar in the aircraft's voice; a *level* (the
  battery's fill, the lit bar count) needs no threshold, being a picture of the number beside
  it. The one exception is a *failed* connection:
  "connect ECONNREFUSED" separates a simulator that is not running from a port typed wrong, and
  it was the one load-bearing thing the old readout showed. The status word is QGC's
  `MainStatusIndicator` shape — link, then failsafe, then arm, then readiness, fused into one
  word and one tint — and it shares `armReadiness` with the Preflight pane, so the two cannot
  contradict each other; only the wording is shorter, because a 52px bar is not where an
  explanation fits. Every string comes from `hud-draw.ts`'s formatters for the same reason.
  Colors are pinned for a **permanently dark ground** (the bar is charcoal in both themes), so
  each tone lifts its own token toward white with `color-mix` rather than duplicating the dark
  palette's value — the trap the `.la-select` chevron fell into — with `--app-on-dark` text
  over the tint. Measured 7.4:1 to 9.8:1.
- **Setup lays its cards out as a grid, not a column** (`.app-content`). They were a flex column
  of 860px cards, which on the full-screen window this app is actually used in put every card in
  a third-width ribbon down the left — measured at 39% of the content area used. Cards are
  independent settings groups, so they tile: `repeat(auto-fill, minmax(460px, 1fr))`, capped at
  four columns past 2600px, because an ultrawide spreading eight short cards over six columns
  reads as scattered. **Cap the column count, never the grid's width**: a `max-width` stops the
  tracks growing the moment four fit, and the slack becomes side padding on an ordinary 16:9 —
  padding nobody asked for, on the screen the grid exists to fill. A media query setting
  `repeat(4, minmax(0, 1fr))` caps the count and lets the tracks keep the width. Three things
  it is easy to get wrong: `auto-fill`, never `auto-fit` — `auto-fit` collapses the empty tracks
  and stretches a lone card across the whole window, the same problem inverted; `align-items:
  start`, or every card in a row grows to the tallest one; and **`.app-content--flush` must undo
  every grid property**, `align-items` above all — `start` on the flex column it becomes made the
  flight screen shrink to its own content, 877px in a 2400px window, reintroducing the exact
  complaint one screen over. Narrower cards also fixed the field rows for free: the system
  sheet's `.la-field` is `1fr auto`, so in an 860px card ~590px sat between "P" and its value,
  and a scoped `minmax(0, 20ch) auto` in `app.css` (the sheet itself is frozen) now puts the
  control beside its label and lines every control in a card up.
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
  **The column is one skeleton for all three**: `PlanActions` (read, write, clear, the badge and
  the transfer note) and `GeoExchange` (files) render outside the per-plan panels, which are left
  holding only what is peculiar to their plan. The order is fixed and the reasons are separate:
  vehicle actions, then file actions, then settings (the documented order), then the *list* —
  shapes or rally points — because a list is the only section that grows and anything under it
  moves down the column every time something is added. The Import/export group is the same
  three interchange buttons in the same place on all three; the mission's own `.waypoints` pair
  is a *second* section under it (Load/save) rather than two extra buttons inside it, which is
  what kept the shared group from starting at the same height on one plan out of three. Offline maps is pinned to the foot
  (`.mission-side__foot`) rather than left at the end of that flow: it is the one section that is
  not about the plan at all, and it should not move when the switch is flipped. **What you draw
  with lives on the map, not in the column**: `ItemPalette` and `FencePalette` are the same strip
  with the same classes and the same arm/disarm behavior, because a fence screen whose tools were
  full-width text buttons in the far column looked like a different application from the mission
  screen beside it. The column is for what *persists* — vehicle actions, files, and the handful of
  vehicle parameters mission planning needs. Things that are not that went where they belong:
  home is a point on the map, so its altitude is edited from its own marker's popup, and
  "use the vehicle's position" is a flyout off the palette's Home button — armed-state, not a
  row of its own, but still on the palette rather than the marker, because the whole point is
  reaching it before a home exists; default altitude and altitude frame stamp the *next* item
  placed, so they sit on the item list's header, on every plan, because that pane is the mission
  list whichever plan is selected. A Leaflet popup holding real controls must
  stop click, scroll and keydown propagation or the map pans on arrow keys and drags on a swipe;
  and because every plan edit rebuilds the marker layer, an open popup has to be noted before the
  clear and reopened after, or typing an altitude dismisses the field it was typed into. Three copies had already drifted — Clear in two
  different places, a failed transfer in a hint on one screen and a note on another, progress
  shown on one of the three — none of it decided. **Clearing always asks**, because clearing the
  screen and clearing the aircraft are different acts and an empty plan cannot show which
  happened: a fence cleared only on screen is still being enforced. The vehicle half is
  MISSION_CLEAR_ALL (`services/plan-clear.ts`), covered for all three mission_types in
  `sitl.integration.test.ts`; a refused clear leaves the screen alone, or the app would report a
  vehicle with nothing on it while it still holds the old plan.
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
- **RealFlight is reached by `--model flightaxis`** over SOAP on port 18083, and it does
  *not* have to be running first. ArduPilot also accepts `flightaxis:<host>` for a copy across
  a network and **the app deliberately does not offer it**: it cost every user a field to look
  at for a case almost nobody has. Add it back on request rather than treating its absence as
  an oversight. SITL binds its GCS port and prints its readiness banner in
  about 40 ms either way, and ArduPilot's `socket_creator` thread retries the SOAP connection
  for as long as the process lives — so "start the simulator, then start RealFlight" is a
  supported order and the app must not refuse it. What SITL will not do is send any MAVLink
  until FlightAxis is exchanging data (`update()` returns early with no sample), so a GCS
  attaches to a silent port and times out. The app therefore probes 18083 to *warn* and to skip
  an auto-connect that cannot succeed, never to block the launch. The setting people forget is
  Simulation > Settings > Physics > "RealFlight Link enabled".
- **With FlightAxis, `--home` places the whole RealFlight field on Earth.** `SIM_Aircraft` sets
  `origin = home`, and FlightAxis adds RealFlight's local coordinates to it, so home decides
  both where the scenery sits and — through the yaw — which way its runway points. That is why a
  chosen home carries a heading at all. **Home is remembered once per physics**
  (`sim-store`'s `homes`, keyed by `homeSlot`): a location measured against RealFlight's
  scenery means nothing to SITL's own model, so one shared value made choosing a field for
  either silently relocate the other. An empty slot means that physics' default, so the
  defaults stay defaults and are never written in as though chosen; an older build's single
  bare string migrates into the slot for whichever physics the rig says was selected, since
  assuming `builtin` would move a RealFlight user's field onto ground it was never measured
  against. RealFlight itself has no geodetic reference: its content
  archives contain no latitude or longitude at all, so nothing in the product can be *read* —
  a position for a RealFlight site can only ever be measured against imagery by eye. That was
  originally a rule against shipping any of them; it is now one pre-filled default,
  `ELI_FIELD`, and the distinction is worth keeping straight. Eli Field is RealFlight's own
  default scenery (a real strip in Monticello, Illinois — Horizon Hobby publishes RealFlight
  and holds its RC Fest there), so with FlightAxis selected and no home chosen, booting at
  CMAC instead puts Canberra's coordinates over an Illinois runway, which is the mismatch
  `--home` exists to remove. It is a measured default and not a survey: `defaultHome()` picks
  it only for FlightAxis, any pick on the map replaces it, and loading a different RealFlight
  site makes it wrong — which is why the map is one click away and the default is never
  written into the saved home. **They are picked on a map rather than typed**
  (`ui/shell/SimFieldPicker.tsx`): a transposed digit in a latitude still parses and boots the
  vehicle a hundred kilometers away looking perfectly healthy, where pointing at the place is
  self-verifying. It carries the two things a copied coordinate pair does not — the heading,
  set by turning an arrow over the imagery until it matches the runway, which is the comparison
  that number exists for; and the AMSL altitude, looked up from the same Terrarium tiles the
  mission profile uses, because almost nobody knows their field's elevation offhand. It renders
  from `App` rather than from the tray that opens it: the tray dismisses on any outside click,
  so a dialog mounted inside it would unmount on the first click on its own map.
- **SITL says nothing about a defaults file it could not open** — not for a missing file, not
  for a bad path. Do not look for an error; there is none. When a launch-path change needs
  proving, the probe that works is `SERIAL0_PROTOCOL -1`, which switches MAVLink off: "did a
  heartbeat arrive" is binary, needs no MAVLink parsing, and cannot pass for the wrong reason.
  `SYSID_THISMAV` looks like the obvious marker and is not — it does not reach the heartbeat
  from a defaults file, so a test built on it can only ever pass.
- **ArduPilot device IDs are packed, and the device type means nothing without its class**
  (`protocol/device-id.ts`, shown as Inspector ▸ Hardware ID). Every detected sensor gets a
  `bus_type:3, bus:5, address:8, devtype:8` word stored in a parameter — INS_ACC_ID,
  COMPASS_DEV_ID, BARO1_DEVID and their siblings — and the tables that name a devtype are
  **per driver**: 0x0B is an ICM20948 to the compass and an MS5611 to the barometer, so a
  decoder that does not take the class with the number puts a confident wrong part on screen.
  The values are ArduPilot's own, from `AP_HAL/Device.h` and the three backends' headers, and
  verified against SITL: the COMPASS_DEV_IDs it reports are exactly its own `SIM_MAG*_DEVID`
  fixtures, decoded back. Zero means a slot the firmware found nothing on, which is a different
  answer from a device it found and this build cannot name — the first gets no row, the second
  keeps its number. It lives in the Inspector because it answers the same question from the
  other side: the message list says what the vehicle is *saying*, hardware says what it *found*,
  and a compass that will not calibrate is usually a compass that was never detected.
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
  exactly that. Climb rate defaults to *following distance*: aviation reads it in ft/min
  wherever distance is in feet, whatever the airspeed unit, so `follow` is what ships and is
  what every build before the control did — which is why adding the control needed no VERSION
  bump, the missing key falling back to exactly the old behavior (there is a test that
  re-imports the store to prove it, rather than a setter that would assert the in-memory
  default and pass regardless). The convention is a default and not a rule, so the dropdown
  also offers m/s and ft/min outright. `resolveVerticalSpeed` is the single place `follow`
  becomes a real unit; nothing downstream knows the convention. HUD tape
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
  square on screen at once. Three more rules, each added because the screen was caught lying:
  **everything that displays cache state subscribes to `subscribeCacheChanges`** (tile-cache's
  own signal, coalesced for writes, immediate for a clear) — the cache is written by panning,
  the download, and the terrain loader, and cleared from a fourth place, so a snapshot overlay
  kept green outlines over tiles that were gone and red hatch over tiles that had just arrived;
  **the coverage overlay takes the base layer's `maxNativeZoom`**, because past native zoom the
  offline map upscales the stored native tile and works, and an overlay without it hatched
  every overzoomed view red however much was stored; and **the download's outcome message is
  composed from the returned `PrefetchProgress`, never the request** — the first version said
  "Stored N map tiles" from the request, which on a dead network was a success message over a
  cache that had gained nothing.
- **Terrain is a raster, and the datum is the part to get right.** Ground elevation comes from
  Terrarium tiles (`services/terrain.ts`) — an ordinary PNG whose RGB encodes one height, from
  AWS's keyless `elevation-tiles-prod`, which is the same SRTM/NED data ArduPilot's own terrain
  server is built from. Zoom 12 is deliberate: that is SRTM's own ~38 m resolution, and more
  zoom resamples the same measurements while downloading sixteen times as much. One tile covers
  about ten kilometers, so a field is one or two and the offline download brings terrain along
  for nothing — and **the mission map's settled view prefetches its own elevation**
  (`prefetchTerrainForView`), because imagery storing itself on the way past had made a
  half-promise: pan your field at home and the map works offline, but the profile there read
  "unavailable", since nothing ever *displays* an elevation tile to store. Unlike the imagery
  this is genuine speculative fetching, defensible only because it stays tiny: fixed zoom,
  already-stored tiles skipped, the area cap returning nothing for a continent, one run at a
  time coalescing to the newest view, paused during a manual download. Three traps, all in `services/mission-terrain.ts` with tests: MAVLink's three
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
  answered — only two questions are left to ask, and both are things a file genuinely does not
  say: which kind of fence a polygon is, and what to do with a file holding nothing of the kind
  being imported. **The buttons therefore belong to no one plan** — they live in
  `ui/tabs/mission/GeoExchange.tsx`, rendered outside the three per-plan panels, because they
  first lived in the mission toolbar, which renders only while `editing === 'mission'`, so the
  fence half of the import was written and could not be reached. A fence exports as KML only
  (GPX has no way to express an area) and is written as a real `<Polygon>`, so it comes back
  through this parser as a fence rather than a route. Parsing lives in `services`
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
- **The mission command catalog is checked against the firmware, not against the spec.**
  `protocol/mission-commands.ts` is hand-written data, and two entries were wrong in ways no
  type or unit test could see: `DO_GRIPPER` was listed as 212, which is `DO_AUTOTUNE_ENABLE`, so
  choosing "Gripper" would have started a tuning run in flight; and `CONDITION_CHANGE_ALT` is
  refused by Copter and Plane alike, so it was a menu entry that could only ever fail on upload.
  `mission-commands.integration.test.ts` now uploads every command in the catalog to whichever
  vehicle SITL is serving and fails on any refusal, so run it against *both*
  (`npm run sitl` and `npm run sitl -- plane`) after touching the list — the two sets differ,
  and `NAV_SPLINE_WAYPOINT` and `NAV_PAYLOAD_PLACE` are Copter-only. Two traps in the test
  itself: mission storage is not ready at the first heartbeat and answers every upload "No space
  on vehicle", which reads exactly like a rejected command; and a `DO_JUMP` to item 0 is
  rejected as *invalid* rather than unsupported, which looks like a catalog error and is not.

- **Do not gate a feature on a capability bit.** A real flight controller reported no
  MAV_PROTOCOL_CAPABILITY_FTP while serving files perfectly well, and the MAVFTP screen believed
  it and told the user their working feature did not exist. SITL sets the bit, so nothing here
  caught it. The bits are still decoded into `vehicle-store` because they are interesting, and
  nothing branches on them: what an operation actually answers — an ack, a listing, a NAK — is
  the only evidence worth acting on.

- **Three airframes take off two different ways, and an ack cannot tell them apart.** Measured
  against SITL, armed: a **copter** and a **quadplane** both take Guided + `NAV_TAKEOFF` and
  climb to the altitude asked for — the quadplane vertically, 20 m up for 3 m of ground track.
  A **fixed wing** answers that same command FAILED and takes off by entering mode `TAKEOFF`
  (13), which climbs away down the runway to its own `TKOFF_ALT`. `NAV_VTOL_TAKEOFF` is
  **UNSUPPORTED on both plane types** — a mission item with no runtime handler — so there is no
  third command to reach for. **The trap is that a quadplane accepts mode `TAKEOFF` too**, with
  MAV_RESULT 0, and flies 277 m of runway takeoff instead of going up; the ack is identical and
  only the ground track says which happened, so this cannot be settled by sending a command and
  reading the result. Hence `takeoffStyle()` in `services/flight.ts`, which both the command and
  the button read so they cannot disagree — and it needs `Q_ENABLE`, because **`MAV_TYPE` cannot
  tell a quadplane from a fixed wing**: both report FIXED_WING(1), and the parameter is present
  on both ArduPlane builds at 0 or 1. An *absent* `Q_ENABLE` means the parameters have not
  downloaded yet, and the two wrong guesses are not equally wrong: fixed-wing-on-a-quadplane
  starts a runway run in a VTOL aircraft, quadplane-on-a-fixed-wing gets FAILED back and does
  nothing — so the unknown takes the route that fails harmlessly. Every one of these facts
  contradicted a confident guess made before the probe ran, including two in a row about the
  quadplane; do not re-derive them from what the documentation implies.
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
- **A z-index cannot climb out of a stacking context, and `.la-appbar` is one.** The SITL tray's
  panel hung inside the app bar and opened *behind* the map. Raising its z-index did nothing and
  could not: `.la-app` is a grid, so `.la-appbar` is a grid item, and a flex/grid item with any
  z-index is a stacking context — everything inside it is capped at the bar's own level 3, while
  Leaflet's control corners sit at 1000 in the *root* context, because nothing between the map's
  panes and the document creates a context at all. The fix is to leave the context: the panel is
  a `createPortal` to `document.body`, `position: fixed`, placed from the button's own rect and
  re-placed on resize. Two things that come with a portal: click-away must ask the panel as well
  as the trigger, since the panel is no longer a descendant of it; and the listener has to be on
  the **capture** phase, because Leaflet's drag handler calls `stopPropagation` on mousedown, so
  a bubble-phase listener never hears a click on the one surface the tray most often covers.
- **Leaflet's own chrome does not follow the app's theme.** Its stylesheet paints popups and
  tooltips as a white card with near-black text, which in dark mode is a light card on a dark
  map. The sheet is a dependency and not ours to edit, so `app.css` restates those few rules in
  `--la-*` tokens (the popup tip is a rotated square: give it the background and nothing else).
- **A flyout inside a scroll box has to be `position: fixed`.** The mission palette and the
  flight screen's View menu both float a menu out of a strip that scrolls, and an absolutely
  positioned child of an `overflow: auto` ancestor is clipped to it — which left the palette's
  "More" menu present in the DOM, twenty-one items and all, and entirely invisible. Both now
  place themselves from the button's own `getBoundingClientRect()` and render fixed. The tell,
  if it happens again, is that the element measures fine and `elementFromPoint` over it returns
  something else.

- **The lower pane is where a second thing goes, not a new panel.** Messages, Status,
  Preflight, Camera and Joystick are tabs of one pane (`LOG_PANES` in
  `stores/flight-layout-store.ts`), because they are all the same thing: something you look at
  in the space under the flight controls, one at a time. Camera and joystick began as panels of
  their own toggled from the View menu, which put "point the camera" in a menu about window
  layout and had them competing with the pane for the same room. Two consequences worth
  keeping: a pane is mounted only while it is showing, which is what stops the joystick polling
  the gamepad while you are reading messages; and a saved pane name is validated on load,
  because a name that no longer exists renders nothing at all with no clue in the tab strip.

- **ADS-B reports say which of their own fields to believe, and that is the whole feature**
  (`protocol/adsb.ts`). ADSB_VEHICLE carries all fourteen fields whatever the receiver actually
  knows, so an aircraft with no position still arrives with a lat and a lon — not zero, but
  stale or noise. Every optional field is therefore `null` unless its flag is set, and a report
  without VALID_COORDS is not a target at all: trusting it draws an aeroplane where there is
  none, which on a traffic display is worse than drawing nothing. Vertical velocity has its own
  flag separate from VALID_VELOCITY. Three unit scales share one message — altitude in
  millimeters, heading in centidegrees, both velocities in centimeters per second — and the
  identity is the ICAO address, whose decoded key is `ICAOAddress` where every neighbour is
  camelCase (a wrong key reads as undefined and every aircraft in the sky collapses onto one
  target). **Unknown is not clear**: `isClose` treats a contact with no reported altitude as
  close when the range is close, because the first cut required a known relative height and so
  drew the least-known aircraft the most calmly. The map tag shows height above this vehicle
  where there is a fix and the aircraft's own AMSL figure where there is not — one value, and
  `relative` on the target says which, because a relative 200 and an AMSL 200 are different
  heights and the fallback must never be silent. It started as a list *and* a map layer; the
  list went, because the map answers the same questions in the place you are already looking. The picture is flushed as a whole snapshot at
  1 Hz rather than forwarded per report, and targets expire after 15 s — several times the
  report rate, because ADS-B reception blinks in and out at range. Nothing here decides
  anything: ArduPilot runs its own avoidance from the same messages (AVD_*).
- **SITL can generate ADS-B traffic, and needs launching for it** — `npm run sitl -- --adsb`.
  Setting the parameters over MAVLink is not enough, and that was measured rather than assumed:
  ADSB_TYPE does instantiate its backend live (its parameters appear with no reboot), but the
  simulated transponder receiver is a `--serial5 sim:adsb` device and the serial protocol that
  talks to it is read once at boot, so a probe that set all three over the link saw exactly zero
  aircraft. The flag writes a second defaults file and passes both (ArduPilot accepts
  `--defaults a,b`), leaving the bench defaults as they came from ArduPilot's autotest tree.
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
then asserts the vehicle really reports being there. **One runner at a time, enforced by a lock file**
(`sitl/.runner.pid`): the quick-exit guard catches a second runner started while the first is
*serving*, but this SITL exits when its client disconnects, so between one connection and the
next there is a window where the port really is free and a second runner binds it happily.
Both then live, each relaunching its own simulator, and which one you reach depends on who won
the last race — with `--home`, a healthy simulator at somebody else's field. A lock whose pid
is no longer alive is ignored, so a runner killed outright leaves nothing to clean up. Measured
rather than assumed: killing the supervisor outright *does* take the simulator with it and free
the port, so orphaning was never the problem — duplicate supervisors were. **Do not check
whether 5760 is free by binding it** — Windows lets a second bind succeed over a listening socket, so the probe says
"free" and you end up talking to the *previous* simulator at its own home; the runner instead
gives up after three immediate exits and says so. `SITL=1 npm test` runs the integration suite against
it (`src/protocol/*.integration.test.ts`, `electron/sitl-core.test.ts`) — **one file at a time**,
because the simulator serves one client and parallel files fight over the slot, losing their
connect windows and reporting "could not reach SITL" while the vehicle is perfectly healthy
(`fileParallelism` is off when SITL=1). For the same reason every integration test connects
through `test-fixtures/sitl-client.ts` rather than calling `net.connect` itself: the runner
relaunches SITL between files, and a connection made in that gap gets ECONNREFUSED, which reads
as "nothing is running" when something is starting. **Run both vehicles.** The suite adapts
where the vehicles genuinely differ rather than assuming Copter — and every one of those was a
Copter assumption caught by a Plane run: `FRAME_CLASS` is Copter's and a fixed wing has none
(`FORMAT_VERSION` is the marker every vehicle carries); `LOIT_SPEED` is Copter's and Plane's is
`WP_LOITER_RAD`; the Phase 5 flight gate is skipped off Copter because ArduPlane refuses
NAV_TAKEOFF in Guided by design; and the parameter-download gate is 3.5 s because 3 s was
calibrated on Copter alone — measured three runs each, Copter serves 1,370 parameters in
2.40-2.53 s and Plane 1,419 in 2.88-3.10 s. **The test suite also asserted the MAVFTP capability
bit** on the grounds that "a real ArduPilot has it" — ArduPlane reports it as zero and serves
MAVFTP perfectly well, which is the same lesson a real flight controller taught the Files screen,
learned twice. The desktop app can
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
