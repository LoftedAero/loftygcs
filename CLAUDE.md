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
- **Navigation** (`src/stores/ui-store.ts`): two levels. Top level is a *mode* — Fly, Plan,
  Setup — switched from the app bar. **Labels move, ids never do**: `plan` is still `mission`
  and "Log Review" is still `logs`, because a saved tab and every deep link already say the id.
  "Plan" is QGroundControl's and Mission Planner's word for that view and the more accurate one
  here, since the mode edits three plans and only one is a mission — the switch *inside* it
  keeps "Mission" for the plan it names; only Setup has the tab rail, and the others
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
- **With no vehicle the rail lists only what can be done now** (`visibleTabs` in `ui-store`).
  Eleven Setup tabs each rendered a card naming the screen and describing its contents, which
  **none of QGroundControl, Mission Planner or Betaflight does** — researched rather than
  assumed. The line the field draws is not planning-vs-setup but *does this need a live exchange
  with this autopilot*: a screen whose subject is a **document** works offline, one whose subject
  is **live vehicle state** does not. So `offline: true` marks Firmware (flashing is a
  no-vehicle workflow in all three references), Parameter List (opens a `.param` file) and Logs
  (opens a `.bin`); everything else leaves the rail, which is Mission Planner's behaviour and
  stated in its own wiki. **Overview is deliberately not one** — it draws itself rather than
  describing itself, which is why it survived the earlier pass, but what it draws *is* a
  vehicle. Losing the link while on a vehicle-only tab drops to the top of what is left, read
  from the list rather than named in `App.tsx`, so changing the offline set needs nothing of
  that file; Betaflight returns to its Welcome tab for the same reason. The `NeedsVehicle` cards
  stay in those tabs deliberately: there is one render between the disconnect and the redirect,
  and Mission Planner keeps its own "you are not connected" messages as exactly that defence.
- **A parameter file is a document, not an aircraft.** The Parameters screen opens a `.param`
  with nothing connected — Mission Planner's offline mode, the one page its disconnected Config
  screen keeps — and `param-store`'s `source` says where the set came from. **Write and Reload
  are disabled while `source` is `'file'`, even once a vehicle connects**: connecting does not
  turn a saved configuration into the aircraft in front of you, and sending one nobody chose it
  for is the failure worth designing against. Revert stays live, because reverting an edit to a
  file is still an edit to a file. Those are the same three buttons Mission Planner greys, which
  are the *only* three controls its entire codebase disables on connection state.
- **A plan is written for an aircraft, and the command set differs** (`commandsFor`). Spline
  waypoints and payload place are Copter-only — ArduPlane refuses them on upload — and that
  knowledge lived **only in `mission-commands.integration.test.ts`**, as a bare set of ids. So
  the test knew something the app did not, and the palette offered splines to a fixed wing
  whether or not one was connected. It is a `copterOnly` field on the catalog now and the test
  reads it, so what the UI offers and what SITL is asked to accept are one list. A connected
  vehicle answers the question itself; with nothing connected the answer is `planFor`, a
  preference, because it is a property of the person rather than of the plan. QGroundControl
  asks the same question and its docs say why; Mission Planner does not, always assumes Copter,
  and has an open issue about it. **An unrecognized MAV_TYPE gets the whole catalog** — unknown
  is not absent, the same rule the MAVFTP capability bit taught.
- **`docs/ui-conventions.md` is the layer above the design system**: how screens in *this* app
  are put together, as opposed to what a button looks like. Every rule in it is kept with the
  feedback that produced it, so a rule can be argued with and a wrong one can be found — add to
  it when a review produces a preference that will apply again, and leave anything that applies
  to one screen only in a comment there. `docs/screen-review.md` is the per-screen gate those
  conventions are checked against before a preview build.
  **`docs/ux-rules.md` is the portable half**: the reviewer's preferences stated without this
  app's mechanisms, with a first-pass checklist, meant to be shared across the Lofted Aero apps
  the way the stylesheet is. Run its checklist on a new screen before showing it; a rule that
  is about *this* app's components belongs in ui-conventions instead.
- **A transport's failure is turned into a sentence before anyone sees it**
  (`services/link-error.ts`). `Transport.open` is documented as rejecting with "a user-readable
  Error" and the IP transports never honored it: they reject with whatever Node threw, and
  Electron wraps a rejected `ipcMain.handle` in its own, so connecting to a simulator that was
  not running put `Error invoking remote method 'link:open': Error: connect ECONNREFUSED
  127.0.0.1:5760` on the app bar — an IPC channel name the user has never heard of, with the one
  useful word buried in the middle. `describeLinkError` matches the **code** rather than the
  message around it (codes are stable across platforms, the wording is not) and names the target
  the user actually typed, not the address inside the error: an EADDRINUSE while binding says
  "Something is already using port 14550". Anything with no code falls through to the cleaned
  text, because an unknown failure said plainly beats a wrong guess said confidently. Two things
  it must keep doing: **cancelling the port chooser returns to idle, not to an error** — Web
  Serial rejects with NotFoundError when someone presses Cancel, and a red chip for choosing not
  to connect is a bug; and the same cleaning runs on a link that drops mid-session, which is
  exactly when nobody wants to read "ECONNRESET" off the bar.
- **A parameter download is reported on the app bar, not on the tab that started it**
  (`ui/shell/ParamProgress.tsx`, QGroundControl's arrangement). It is the one long operation that
  is not about the screen you are on — it starts on connect, on a reboot, and on writing a
  parameter that gates others — and until it finishes *every* curated tab is showing an
  incomplete vehicle. It keys off `progress` as well as `loadState`, because a quiet refresh
  deliberately never touches `loadState`, and it sweeps rather than sitting at 0% before the
  first packet, since a bar parked at zero reads as stalled. Absolutely placed on the bar's own
  foot so it is not a grid item: it appears and disappears while someone is reading the bar, and
  a layout that shifted under that would be worse than no indicator (measured — nothing moves,
  the bar stays 52px). Blue, not QGC's green, because this app's other two progress bars are
  blue and one carries the reason beside it: progress is activity, not a status verdict.
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
  gear already was): three glyphs is not a reason to take on an icon set (eight was — see
  `ui/tabs/firmware/VehicleIcon.tsx`), and they have to take
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
- **The actions column is two classes, and both are required**: `.app-col-shell` around
  `.app-col` (`app.css`). Every screen that edits something has a fixed-width column on the
  right holding what you *do*, beside the thing you are doing it to. The **shell** owns the
  frame, the background and the scrolling; the **inner** `.app-col` owns the padding and the
  rhythm between groups — split that way so a column can also sit inside a card that already
  has a frame, by leaving the shell off. This entry used to claim the screens shared one set of
  classes "so they cannot drift"; they did not, and they had. `.app-col-shell` was written for
  this job and **nothing used it**: Parameters and Mission had its three lines pasted into
  `.params-aside, .mission-side`, OSD had them a third time in `.osd-actions`, and Logs and
  MAVFTP had no frame at all — so on Logs the *left* field list was framed and the right
  column was not, on one screen. Mission had the frame but no inner padding, so its content sat
  against the border. A claim in this file that something cannot drift is worth checking before
  it is relied on. `src/styles/panel-frame.test.ts` guards both halves: it pins every selector
  allowed to draw the frame itself, so the next copy is a deliberate edit rather than a paste,
  and it fails on a bare `.app-col` rendered without a shell — which is how the Inspector's
  detail column, and before it Logs and MAVFTP, came to have no frame at all.
  **And a screen either *is* a card or *contains* framed panels, never both**: Parameters
  wrapped its table and its column in a `LaCard`, which put a white bordered column 17px inside
  a white bordered card, so the column's frame read as a division rather than an edge. It is now
  a full-height screen (`.params-screen`), which is the shape MAVFTP already had — a card while
  there is nothing to show, its own layout once there is.
  **Every screen with a column is `fills: true`**, and all four went without it: each one's root
  sets `flex: 1; min-height: 0` expecting to fill, and on the card grid — whose `align-items` is
  `start` — `flex` is inert, so they sized to their content and the *page* scrolled. The column
  then rode away with the list, which is the one thing a column must not do; no sticky
  positioning is needed once the container is right. It also meant the parameter table's
  virtualizer measured a scroll box with no bounded height, so it had no window to virtualize
  against — 1,400 rows of a list that exists to render a slice. `fills` costs one thing worth
  knowing: `.app-content--flush` stretches its children, so a filling tab's *placeholder* card
  needs `max-width` or a one-line "connect a vehicle" note becomes a full-window banner.
  **The column is placed in the main pane's grid row, not beside the whole screen**, so the two
  framed panels start and end on the same lines — Parameters, MAVFTP and the Inspector each
  wrapped their bar and their pane in a flex column, which left the actions column spanning all
  of it and standing 58px taller than the panel it sits beside. A pane's toolbar and caption go
  in that pane's *track* (the search filters the list, the path bar names the listing, the count
  describes the table); only something that changes what the whole screen shows, like the
  Inspector's view switcher, spans both tracks. Parameters goes one further and puts them
  *inside* the frame: `.params-pane` is a flex column of a `flex: none` header, the scrolling
  rows, and a `flex: none` footer, so the panel is the full height of the screen and the frame
  belongs to the pane rather than to `.params-scroll`. Rows then scroll *between* the search and
  the count rather than under either — checked with `elementFromPoint` rather than with bounding
  rects, which run past a scroll box even when `overflow` clips them and so answer the wrong
  question. The gap between pane and column is
  `--app-col-gap`, which was four different values across five screens. The rules: width is `var(--app-col-w)`, never a bespoke number; buttons are always
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
  edits prompts (`ui-store`'s `pendingNav`), so a screen's column can own its own Write.
  **The footer has no Write.** Every Setup screen writes from the card that owns the edit
  (`CardParamActions`), from its column, or as it is used; the footer's copy went once the
  last three screens (Radio, Power, Failsafe) had cards of their own. The leave-page prompt's
  "Write and continue" is what still catches a write-as-you-go field whose write failed and
  fell back to staged.
- **Curated tabs** are declarations, not code: `ParamCard` takes a field list, drops params
  the vehicle lacks, and hides itself when empty — so one definition serves Copter, Plane,
  and Rover. `ParamField`'s `bare` prop drops the label for table layouts.
  **`writeNow` is the one exception to staging, and it is narrow on purpose.** Edits stage so the
  action bar's Write covers all of them and nothing reaches the vehicle on keystroke; a
  parameter that *gates other parameters* breaks that, because the screen shows nothing until it
  is written. `OSD_TYPE` is the case — at 0 the vehicle reports no panel positions, so staging it
  leaves the OSD page empty however many times a backend is picked. The field writes, then calls
  `refreshParams({ quiet: true })`, which is where the newly exposed parameters come from. Two
  things that flag needs and would be bugs without: **it never writes on a keystroke** (a
  dropdown writes on change, a number field on Enter or blur — "50" passes through 5 on the way,
  and a field writing every digit would send a value nobody chose); and **a failed write falls
  back to staging** rather than vanishing, so the choice survives and Write is its honest state.
  A *quiet* refresh is equally particular: it skips `beginDownload` (which would blank every
  curated tab to a loading card) and calls the store's `merged` rather than `loaded`, because
  `loaded` rebuilds from scratch and would silently discard staged edits — a worse bug than the
  one the refresh exists to fix. A dirty entry keeps its staged value and only learns what the
  vehicle now says it is staged *against*, so a value the vehicle has caught up with stops being
  an edit.
- **A screen that cannot be used yet is drawn disabled, not replaced.** The OSD tab returned a
  single card while `OSD_TYPE` was 0 — and that card replaced the whole workspace *including*
  `OsdWorkspace`'s own column, which holds the Display card where `OSD_TYPE` is edited. The
  state hid its own fix and the only way out was the Parameters table. (There was briefly a
  second, emphasized "The OSD is off" panel offering the backends by name; it went, because the
  Display card already carries the parameter *and* the hint saying what being off means.) Everything now
  renders and `osdOff` disables it: the panel switches, the screen radios, the grid select, the
  coordinate spinners, and dragging on the preview (`OsdScreen`'s `disabled`), with the mutating
  helpers guarded as well so a missed control cannot stage a parameter. The empty case keeps its
  own words, because the two are different news: with the OSD off the vehicle reports no panel
  positions at all, which is not the same as a firmware that has no panels for that screen.
  **When removing a screen's content, check what the empty state takes away with it.**
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
  probes both rather than assuming. **A cancel returns at once and closes the session behind
  it** (`MavFtpClient.cancelRead`): awaiting the TerminateSession ack held the button for 589 ms
  against SITL, because the one-request-at-a-time server answers it only after the burst already
  on its way -- which is also why the next request after a cancel waits about that long. A
  canceled read never falls back to sequential reads, and it ends quietly, not as an error.
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
  (`protocol/device-id.ts`, shown as Sensors ▸ Hardware ID). Every detected sensor gets a
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
- **The firmware manifest is mostly the parts an earlier reading threw away**
  (`services/firmware-manifest.ts`). Every number here is measured against the live
  `manifest.json.gz` (97,248 entries), not estimated. Three fields decide whether it is read
  correctly. **`mav-type`, never `vehicletype`**: `vehicletype: "Copter"` covers multirotors
  *and* traditional helis — 14,708 rows that `mav-type` splits into Copter and HELICOPTER,
  which are different images, so keyed on `vehicletype` the screen offered both under one name
  and flashed whichever sorted first. **`mav-firmware-version-type` has four shapes, not
  three**: `OFFICIAL` (what the `/stable/` path serves), `BETA`, `DEV`, and `STABLE-4.6.3` for
  every release ever published — which is 28,143 of the 33,915 flashable rows, so reading only
  the first three discarded every firmware older than today's, exactly what someone downgrading
  is after. **A `board_id` of 0 is "not stated", not board zero**, and 65% of the file has no
  id at all (every hex/elf/bin row); both would poison the join. Two traps in the tidying that
  follows. `Copter/stable/CubeOrange` and `Copter/stable-4.7.1/CubeOrange` are the same build
  listed twice (1,683 of 1,786 current rows), and dropping the twin **must test the channel**:
  ArduPilot cuts beta and stable at the same version number, so a key without it collided
  `beta 4.7.1` with `stable 4.7.1` and quietly removed all 1,787 beta rows. And versions
  compare numerically per segment or "4.10.0" sorts before "4.9.0" and the downgrade list
  offers the wrong build at the top. **Which release is current comes from the `OFFICIAL` flag,
  not from the top of a sorted list** — they agree for every board today, but by coincidence:
  `/stable/` is authoritative about what is current where an ordering is only a fact about
  strings, and the manifest already carries rows whose reported version disagrees with the
  directory serving them (Rover's stable-3.4.2 reports 3.5.0). The fallback through beta to dev
  is load-bearing rather than polite: **Blimp has never had a stable release** and exists only
  on `dev`, so "current stable or nothing" leaves one of the eight vehicles permanently empty.
- **A board is identified by asking its bootloader, and by nothing else** (`identifyBoard` in
  `services/flash.ts`). `GET_DEVICE`/`BOARD_ID` is the whole of Mission Planner's detection and
  the only authoritative identifier either app has. **USB ids cannot stand in for it** — checked
  rather than assumed: 44 distinct USBIDs against 317 board ids, and the generic ArduPilot pair
  `0x1209/0x5741` alone covers 18,551 rows, so a board resolved from them is not resolved. Nor
  can the live link answer it, since ArduPilot's flash path is bootloader-only and the port
  re-enumerates as a different device on the way in. What the id buys is Mission Planner's
  narrowing: among current builds, board id × `mav-type` is exactly one platform for 198 of 317
  boards, several for 32 (usually a `-bdshot` sibling, which is a real choice and not something
  to guess at) and none for 87 — so a lone match is chosen outright and anything else is left to
  the list, which by then holds only builds that board can take. Keyed on `vehicletype` it is
  *never* exactly one, because the heli twin is always beside it. **The rule that is easiest to
  get wrong is that a probe running behind the screen must not be able to prompt.** Opening a
  serial port needs `requestPort()`, which needs a user gesture *and* shows a port chooser; the
  one exception is a port already granted, which `getPorts()` returns with neither. So the
  automatic probe passes `askForPort: false` and gives up unless exactly one port is already
  granted, and only the flash — which somebody pressed — passes `true`. Driven headless, the
  first version put the browser's chooser up on every click of a vehicle symbol and sat on
  "Checking the board…" until it was answered. **The flash is one button and it reboots the
  board itself** (`identifyBoard({ reboot: true })`): a board plugged in to be flashed is
  normally running its firmware, which answers the bootloader handshake with silence, and the
  first version skipped the reboot unless the app was already MAVLink-connected — so a healthy
  Cube reported that it would not identify itself. The reboot is `PREFLIGHT_REBOOT_SHUTDOWN`
  written blind down the same port, broadcast ids, no ack awaited, which is what `uploader.py`
  does. Three traps around the port, every one found with a Cube Orange+ on the bench. The port
  is acquired **once** and passed to both the probe and the reboot — letting each transport ask
  for its own put the same chooser up twice for the same device. The "before" snapshot for
  spotting the bootloader's port is taken **after** the chooser, or the port just picked is the
  newest grant and gets handed back as if it were the bootloader. And the bootloader is a
  *different* USB device, so Web Serial's per-device grant does not cover it: the browser build
  polls `getPorts()` and listens for `connect` (which fires for an already-granted device
  re-enumerating — the second flash of a board) inside a budget kept under the ~5 s a click
  stays a gesture, because a `requestPort()` fallback outside it is refused. **The desktop shell
  does better because it owns the chooser**: `electron/main.ts` intercepts `select-serial-port`,
  so it sees every port on the machine, and `serial-port-added` fires while a request is held
  open — so the flash path arms `serialPicker.autoPickNew()`, asks at once while the gesture is
  fresh, and main holds the callback until exactly one new port appears
  (`electron/serial-autopick.ts`, tested), falling back to the chooser with everything that
  arrived in it. Two new ports is a choice, not a guess. **The chooser itself is live**: main
  keeps one open request's list current from `serial-port-added`/`-removed` and re-sends it, so
  a board plugged in with the chooser already up appears in it, and a bootloader announcing
  itself while the chooser is up answers the request and closes it. It had been a snapshot,
  and the bench showed a chooser with no bootloader in it while a restart showed one with. Two
  facts the recogniser depends on: an ArduPilot bootloader's product string is the hwdef name
  with `-BL` on it (the manifest's `bootloader_str`), and **Electron hands over
  `vendorId`/`productId` as decimal strings built from uint16s** — `0x1209` arrives as `"4617"`,
  and a hex parse of that is a vendor that does not exist. The chooser's own `hex()` helper
  documents the same rule; a test that passed a hex string was passing for the wrong reason.
  **And Windows keeps a phantom.** Traced with the main process instrumented
  (`LOFTGCS_DEBUG_SERIAL=1`) and the Cube on the bench: after the board reboots into its
  bootloader, the old MAVLink port stays in Chromium's list, not openable (`FILE_ERROR_NOT_FOUND`),
  and Chromium re-reads *its* product string as `CubeOrange-BL` as well — two bootloaders by
  product string, so "exactly one or ask" correctly refused, and the chooser came up. The Windows
  driver names (`serial-names.ts`, the source Mission Planner reads) are the truth — "Cube Orange
  Mavlink" versus "Cube Orange Bootloader" — so the recogniser fetches them first and lets a
  driver name that says MAVLink or SLCAN veto a product string that says bootloader, and a port
  that *arrived* during the request outranks any lookalike already in it. The flash path also
  arms the shell before its *first* ask, without a hold: a board already in its bootloader — a
  fresh plug-in, or a flash cancelled at the confirm — is answered for with no chooser at all.
  Measured end to end: from the Flash click to the confirm dialog with the right board id, zero
  choosers with the board in its bootloader, one with it running firmware. **Three rounds of
  reasoning about this from the code were each confidently wrong; one instrumented run settled
  it in a minute.** When the hardware is on the bench, drive it before theorising.
  **Flashing while connected works, and is not refused** (Mission Planner throws "can't flash
  while connected"). The flash reboots the vehicle over the live link with a 400 ms ack timeout
  — the ack never comes, the vehicle obeys first, and `runCommand`'s two retries at the default
  5 s had it sitting on "Rebooting…" for fifteen seconds — drops the link, and carries on; the
  first port ask then holds like the post-reboot one does, because the board is mid-way back.
  Measured from the live link: confirm dialog with the right board id at 2.5 s, no chooser. A
  **cancelled** flash sends the bootloader's REBOOT so the board boots the firmware it still
  has; left in its bootloader it sat there until a power cycle, which is what the bench showed. And `preferredPlatform` picks the plain
  build when the others are suffixed variants of it (`-bdshot`, `-SimOnHardWare`): board id 1063
  fits three, and "exactly one match or ask" prompted for one of the commonest boards there is
  every single time. A board with no build for the chosen
  vehicle falls back to every release it ever had rather than an empty list, which would read as
  "this app does not know your board" when the truth is that the vehicle was dropped from it.
- **DFU is not a recovery path, it is how most boards get ArduPilot in the first place.** A
  flight controller ships with Betaflight, INAV or nothing, so it has no ArduPilot bootloader
  and cannot take an `.apj` at all; it takes the `_with_bl.hex`, which is the bootloader and the
  firmware in one image, over the STM32's own ROM loader. So the Firmware tab is **board first, then firmware** —
  QGroundControl's ordering, and the one that dissolves the problem rather than fencing it. You
  cannot choose the right firmware without knowing the board, so **Detect board** comes before
  anything is offered — and it sits in the Board row it fills, not at the foot with the flash,
  which had put "find out what this is" below everything that depends on knowing — and *the way the board turns up is the way it gets flashed*: answering the
  ArduPilot bootloader handshake means the `.apj` over its port; enumerating as `0483:DF11` means
  the `_with_bl.hex` over USB. Nothing about that is a setting, and a toggle would only have
  asked the user to declare something the app must verify anyway. It went through two cards side
  by side, then two sections with a button each, then one button that sniffed for DFU at flash
  time — every one of those asked the user to know which kind of board they had, and the last
  left **a hole for a file the user brings**, since the builder and Open file hand over an `.apj`
  *or* a `_with_bl.hex` and which one fits depends on the board. With the board known first the
  file picker's `accept` is the one extension that can work, the vehicle tiles are disabled for
  a vehicle this board has no build for, the release list is exact for this board, and the
  custom-build tile says which artifact to download. The DFU target is asked for once, up front,
  from the flat catalog, because DFU has no board id and nothing in the manifest narrows it
  (there is no MCU field; measured); the user is trusted to pick. **A board identified over
  serial is left running nothing**, so "Change board" and unmounting the screen both call
  `bootBoard` to jump it back into the firmware it still has — the bench stranded a Cube three
  times before that existed; pressing Detect again releases the previous board the same way, so
  there is no separate "change board" -- but only *after* the new detect, and only if it ended
  on a different board. Released first, the board about to be read was rebooted out of its
  bootloader just as its port was asked for; the chooser came up over a phantom, and the auto-pick
  then answered it with the firmware's SLCAN port, which is why the list-difference fallback in
  `serial-autopick.ts` now takes nothing a driver names MAVLink or SLCAN. **Detecting reboots the
  board, so it is guarded**: armed
  is refused outright (an armed vehicle is one whose motors can turn, on the ground or not), and
  so are MAV_STATE ACTIVE and the two failsafe states, CRITICAL and EMERGENCY — ArduPilot's own
  words for flying and for a failsafe running. Connected but standing still is *asked* rather
  than blocked, because it still drops the link and stops the firmware; the dialog says so and
  says nothing is erased. `FirmwareTab.test.tsx` pins all five states, because this is the one
  control on the screen whose worst case is a crash. The refusal also sits directly under the
  two error lines in the state line's priority, above anything informational — it was below
  "browsing builds needs the desktop app", which is how a safety line ends up hidden behind a
  notice. Calling the DFU path "recovery" before all this was wrong too,
  and made the common case look like an emergency. **Deciding the path in the app opened a hole
  for a file the user brings**: Open file and the custom builder hand over an `.apj` *or* a
  `_with_bl.hex`, and only one of them fits the board in front of them. So the rule is that
  **the file decides the path** — `.hex` over DFU, `.apj` over the serial bootloader — the
  loaded line says which, and a mismatch is explained at Flash in terms of the *file*: an
  `.apj` with the board in DFU mode says to use the `_with_bl.hex`, a `_with_bl.hex` with a
  board running ArduPilot says to hold BOOT0. Opening the custom builder sets a line saying
  which artifact to download, from what is plugged in at that moment. And **a `.hex` whose
  first record is not at `0x08000000` is refused**: ArduPilot's `make_intel_hex.py` writes
  *either* a `_with_bl.hex` at the flash base *or* an app-only `.hex` at the board's reserve
  offset, never both — its own comment says users confused them — and the app-only one over DFU
  lands an application where the bootloader should be. **The shaded state line is the one place verbosity is allowed**:
  it narrates every step of a flash in a sentence — rebooting, waiting for the bootloader,
  reading the id, downloading which build, erasing, writing, verifying — because a flash is the
  one operation where somebody is watching a bar and wants to know what it is doing. The DFU path
  is now flown end to end on hardware (a TBS_LUCID_H7_WING, erase 76 s, write 124 s, verify 8 s,
  208 s in total, board rebooting into ArduPlane 4.7.1 with its MAVLink and SLCAN ports back) —
  and every one of the things below is a bug that flight took out, none of which a test could
  have found first. **The alternate setting must be chosen, never inherited**: an STM32 in ROM DFU
  exposes `@Internal Flash`, `@Option Bytes`, `@OTP Memory` and `@Device Feature` on one
  interface, and this code took `interfaces[0].alternate` — whatever the device came up on —
  and never called `selectAlternateInterface`, so which region got written was the device's
  choice. OTP is one-time programmable and the option bytes decide whether the chip boots, so
  two of the four are worse than a wrong firmware. **There is no board id.** Every STM32 in ROM
  DFU is `0483:DF11` whatever it is soldered to, and the serial number is the chip's unique id,
  not a model; the serial bootloader's board-id gate has no equivalent here. Worse, the board
  *afterwards* reports whatever board id the flashed bootloader was compiled with
  (`AP_Bootloader.cpp`'s `.board_type = APJ_BOARD_ID`), so a wrong image leaves `identifyBoard`
  confidently naming the wrong board — a failure that looks exactly like success, which is why
  the screen says so where the decision is made rather than in the confirm. The one automatic
  check available is the image's top address against the flash the descriptor reports, which
  catches a wrong-MCU image and never a MatekH743-for-CubeOrange mix-up. **Verify is not
  optional.** ST's AN3156 says of the erase command: *"No error is returned when performing
  Erase operations on write protected sectors"* — so a clean run of acks is not evidence
  anything was written, and a protected board completes the whole sequence and boots its old
  firmware. Betaflight's configurator verifies unconditionally and STM32CubeProgrammer's own
  Rev 29 figure ships with "Verify programming" ticked; `DfuseFlasher.flash` reads back and
  compares, with a flag to skip it only for a ROM that will not serve an upload. The
  write-protected board is modelled in `dfu.test.ts` rather than assumed — and that fake is
  deliberately **strict** rather than permissive now: it stalls an oversized payload, a
  CLRSTATUS outside dfuERROR, an UPLOAD outside idle, and a block number that does not
  increment in either direction. Each of those was added after the silicon refused the same
  thing, and each was checked by reverting the fix and watching the test fail; a permissive
  fake had been passing every one of these for the wrong reason.
  **The layout string is read from the descriptors, not from `interfaceName`.** ST encodes the
  memory map in the interface name — `@Internal Flash /0x08000000/16*128Kg` — and every DFU
  feature here reads it, but Chromium on Windows returns `interfaceName: null` for a
  WinUSB-bound device that is otherwise perfectly healthy. That made the whole path
  unreachable: `identifyDfu` threw "reports no internal flash" and both callers dropped the
  reason. `dfuDescriptors` now fetches the configuration descriptor, walks it for each
  interface's `iInterface` index and asks for those string descriptors, the way dfu-util does;
  `interfaceName` is still preferred where a browser fills it in. Reading it also gives the
  sharpest argument for selecting by name: on that board alternate 0 is the flash and
  **alternate 1 is `@Option Bytes`**.
  **`wTransferSize` is a limit the device sets, not a constant.** It rides in the DFU
  functional descriptor (type 0x21) in the same block, and DFU 1.1 §6.1.1 forbids a DNLOAD
  payload larger than it. This was hardcoded at 2048 against a board declaring 1024: the first
  data block stalled, the STM32 latched into **dfuERROR**, and it then refused everything —
  CLRSTATUS included — across app restarts until it was physically power-cycled. A device that
  declares nothing gets 1024, which every STM32 ROM loader accepts; never a guess in the caller.
  **Which request returns a device to idle depends on the state it is in** (`toIdle`, ported
  from Betaflight Configurator's `src/js/protocols/usbdfu.js`, GPL-3.0 as this is): ABORT from
  dfuDNLOAD_IDLE or dfuUPLOAD_IDLE, CLRSTATUS *only* from dfuERROR, and otherwise poll while
  the device says it is busy, bounded so a wedged ROM errors instead of hanging. A blind
  CLRSTATUS is not harmless — a strict ROM stalls it exactly per spec, which killed the
  read-back the instant it started, and Betaflight's own comment names that symptom. Their file
  carries the H7 exception too: some H743 Rev.V bootloaders wedge in dfuDNBUSY after an erase
  and never settle, and STM32CubeProgrammer unsticks them with an undocumented CLRSTATUS pair
  (the first answers errUNKNOWN/dfuERROR, the second OK/dfuIDLE) — opt-in via `busyIsStuck`,
  because a strict ROM must never be sent one it would rightly refuse. **`leave()` is the same
  rule one step later**: the read-back ends in dfuUPLOAD_IDLE, and a DfuSe command is itself a
  DNLOAD, so it must reach idle first. That was the last thing standing between a complete
  write and a finished flash.
  **The address is set once per segment and the device walks it** as wBlockNum counts up from
  the DFU-mandated 2, for reads and writes alike. Re-sending it per chunk looks harmless and is
  not: a DfuSe command is a DNLOAD, so the device goes busy and reports a poll timeout for it
  exactly as for a real write, and every block paid **two** busy-waits — one for an
  address-pointer write that touches no flash. Measured: 151 ms a block, 247 s for 1.6 MB,
  against a read-back of the same bytes over the same bus in 8 s. Setting it once halved the
  write to 124 s.
  **And the DFU device is probed under the same rule as the serial one**: `getDevices()` for
  the silent look, `requestDevice()` only from something somebody pressed, because work the
  screen starts by itself may not raise a chooser. (This entry used to claim a re-probe on
  every USB connect/disconnect. There was no such listener and never had been — worth
  remembering that a claim in this file is not evidence.) The silent look sees only what this
  origin was already granted, which for a board nobody has granted yet is nothing, so the ask
  happens **after the serial path fails** rather than only when its chooser was cancelled: a
  board in DFU mode has no serial port at all, so reaching the prompt by dismissing a chooser
  full of unrelated ports meant a first detect could not succeed. In the shell there is no
  chooser to dismiss — `electron/main.ts` answers `select-usb-device` itself from the
  `0483:DF11` permission handler, and **holds the request** for 2.5 s when the list is empty,
  because Chromium has been measured enumerating a device 1.2 s after the request for one that
  was plugged in before the app started. `LOFTGCS_DEBUG_USB=1` traces that side the way
  `LOFTGCS_DEBUG_SERIAL=1` traces the other, and it is what made all of this visible: the shell
  shows nobody a chooser, so a DFU board that is not found leaves no trace on screen at all.
  **Betaflight's `usbdfu.js` is the reference implementation to read before theorising here.**
  Three of the four bugs above are described in its comments, H7 quirks included. Several
  rounds of reasoning from our own code reached confident wrong answers first, at one bench
  power-cycle each — the same lesson the serial bootloader taught, learned again.
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

- **An accelerometer calibration cannot be cancelled, and it asks rather than tells.**
  `AP_AccelCal::cancel()` exists and is reachable from exactly one place — arming the vehicle
  — so there is no MAVLink way to stop a run part-way, and `start()` returns immediately while
  one is already running, acking anyway. A wizard closed mid-run therefore leaves the vehicle
  waiting for a side indefinitely, and the next PREFLIGHT_CALIBRATION is silently ignored.
  What makes that survivable is that the firmware **repeats its request**:
  `send_accelcal_vehicle_position` sends a COMMAND_LONG carrying MAV_CMD_ACCELCAL_VEHICLE_POS
  with the step in param1, every second, for as long as it waits — where the matching
  "Place vehicle on its LEFT side and press any key" STATUSTEXT is printed **once** per side.
  So the wizard follows the command and keeps the text only for the wording and the verdict,
  which is what lets it rejoin a run it did not start; the text path stays as a fallback for a
  firmware that stops repeating itself. Two traps: the same message carries a terminal
  SUCCESS/FAILED that the vehicle goes on repeating long after a run is over, so a wizard that
  trusted it would show the last run's verdict a second after starting a new one (hence the
  arrival time beside the value, and reading only steps 1-6); and the param fields are
  **`_param1`…`_param7`** in mavlink-mappings, not `param1` — the encoder takes any key it is
  given, so the wrong one produces a well-formed request to be placed in side zero. The
  sides are walked in order and `_step` only counts up, so the side being asked for is also
  how far the run has got, which is the only way to fill in the tiles when rejoining.

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
  nothing persists it; it refuses to start unless the spring-centered sticks are centered
  (`sticksAreSafe`, because the pad is usually on a desk under something). Which axes those are
  is each axis's *Centered* switch, the one property that changes behavior: a centered axis
  gets the deadzone, expo and that check, one that stays where it is left gets none of them.
  A spring-centered throttle is just a centered axis, sitting at 1500 when released -- right for
  the altitude-holding modes, half throttle in manual ones. **The throttle is
  deliberately not checked**: control taken over from a transmitter in flight is taken at hover
  throttle, and a throttle-down check could only be passed by cutting the motors. It stops
  itself on unplug, on a different device taking the chosen one's place, and on link loss.
  Handing control back on purpose is the app's Release, in the pane and on the app bar from
  every screen; a gamepad button mapped to release existed and went, as a second way to do what
  the bar already does in one click. **Stopping means sending the release,
  not going quiet** — a vehicle whose override stream stops holds the last value until
  RC_OVERRIDE_TIME runs out — and **the release is a different number above channel 8**, which
  is the trap: measured against SITL and per the spec, channels 1-8 take 65535 as "no change"
  and 0 as release, channels 9-18 take 0 as "no change" and 65534 as release. The first version
  released with zeros, which hands 1-8 back and leaves every switch on 9-16 held where the
  gamepad left it; `sitl.integration.test.ts` now proves both halves on channel 10, and fails
  against a zeros release. So every frame is built per channel from `ignoreValue`/`releaseValue`,
  never from a literal; an unmapped channel goes out as "no change", never as 1500, because
  centering it drives a flight-mode switch to its middle position; and a throttle gets no
  center deadzone, which would be a dead patch mid-travel.
  **A button is momentary, toggle, set, or flight mode.** *Set* is how several buttons make one
  switch: each sends its one value from the press on, latched per channel, so three on the mode
  channel are its three positions and they are not a conflict with each other. *Flight mode*
  drives no channel at all: it stores ArduPilot's *name* for a mode and resolves it against the
  connected vehicle when pressed, because the numbers are per vehicle (RTL is 6 on Copter, 11 on
  Plane) and a profile moves between them; a name the vehicle lacks is said, not guessed at, and
  it acts only while the gamepad has control. Proven in the app against SITL: Stabilize to
  AltHold from a gamepad button, read back from the heartbeat. (A *cycle* that stepped one button
  through a list existed briefly and went, because Set covers it with a button per position; a
  saved one reads back as a toggle.) Two rules keep buttons from moving anything on their own. A
  toggle starts on whichever of its values is nearest what the vehicle's channel reads now, and
  a set channel is left alone until one of its buttons is pressed (`initialButtonState`), or
  taking control would move every mapped switch -- the flight mode included -- to position one; and
  a button already held when control is taken is *primed*, not stepped (`primeButtons`) — the
  first version stepped it, which counted the held button as a press and flipped the switch on
  the first frame. The same rule covers any change to the mapping: the press that *Learn* takes a
  button from is still down on the next read, so the service re-primes whenever the mapping
  object changes rather than only when the button count does.
  **The pane shows; the dialog edits.** The Joystick pane is the sticks drawn live on the Radio
  screen's transmitter (`StickDiagram`'s `positions`) beside a bar per mapped channel; what
  drives each channel is changed in Configure only. The pane once carried its own copy of the
  mapping and was taken back out: two places to make one change was worse than one click.
  Nothing in the dialog is editable while control is taken either.
  **It keeps flying when you look away.** The pad is read for the whole session from `App`, not
  by the pane, so leaving the Fly screen or the Joystick pane does not drop control, and the app
  bar says control is taken — with a Release — on every screen (`ui/shell/JoystickChip.tsx`, in
  the middle band because that is the track allowed to change size). In the desktop app,
  taking control turns the window's background throttling off (`app.setBackgroundThrottling`,
  back on at release), so the *app* keeps running minimized or unfocused — measured in the built
  app against SITL: six seconds minimized, twice RC_OVERRIDE_TIME, the channel never dropped
  and the page's timers never slowed. **That was with a stand-in pad, so it proves the app's half
  only; whether Windows keeps delivering a real controller's input out of focus depends on
  which Chromium backend reads it.** HID joysticks (HOTAS, wheels, a transmitter's USB mode) come
  through RawInput, which Chromium registers with `RIDEV_INPUTSINK` -- background delivery, by
  its source. Xbox-type pads come through Windows.Gaming.Input (GameInput on Windows 11 behind a
  flag), whose background behavior for a desktop app Microsoft does not document, and it is
  untested on hardware. If that ever matters, the answer is reading those pads through XInput
  in the main process, which Windows delivers regardless of focus; it was judged out of scope
  (2026-09-27). A browser has no throttling switch and may freeze an unfocused pad, so there
  losing focus still releases; a page the platform reports hidden releases in either, because
  a stick that has stopped updating is worse than no stick.
  **An empty device list at launch is Chromium, not a fault**: it hides every gamepad from a page
  until a button is pressed on one of them after the app starts, and reports four at most —
  measured on the bench with an Xbox pad and a 3Dconnexion joystick attached, `getGamepads()`
  four nulls for as long as nobody touched either. There is no switch for it, so the list is
  always drawn and says to press a button, rather than looking broken.
  **With more than one input device attached, nothing is read until someone says which** — a
  wheel, a HOTAS and a gamepad on the same desk all appear in `getGamepads()`, and taking the
  first is taking whichever the browser happened to enumerate. The choice is remembered by the
  device's reported *id*, never its index: indices shuffle between sessions, so a remembered
  index is a remembered different device. **A mapping belongs to a device** by the same id —
  plugging one in brings its own back, a device seen for the first time starts from the Mode 2
  default rather than the last device's axis numbers, and the mapping never changes under the
  hands while flying. Named profiles sit beside that and move as files; everything read from
  storage or a file goes through `sanitizeConfig`, and an import must *look* like a mapping
  first, because sanitizing any JSON at all yields a valid default and would load a
  `package.json` as one. Proven against SITL both ways — the override reaches the vehicle's
  RC_CHANNELS *and* the release hands them back — because the encoder accepts any field name
  and a wrong one produces a well-formed message full of zeros that a fake would happily
  accept.
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

- **The Fly screen's two sizes are both bounded** (`.flight-grid` in `app.css`), measured by
  sweeping six window sizes from 1280x720 to 3440x1440 against six splitter positions. The
  pinned panel's row is its 4:3 height *capped* to leave room for the controls (measured live,
  since they wrap) and 150px of lower pane: uncapped, the lower pane was 9px at 1280x720 and the
  HUD ran off the bottom of an ultrawide. The left column is held between 440px floors on both
  sides -- below that the controls spilled out of their box and the lower pane's tabs wrapped --
  and stops at the width where the capped panel fills it, since past that the splitter only drew
  empty bands beside the HUD. The right-click menus place themselves by their measured size.
- **The lower pane is where a second thing goes, not a new panel.** Messages, Status,
  Preflight, Camera and Joystick are tabs of one pane (`LOG_PANES` in
  `stores/flight-layout-store.ts`), because they are all the same thing: something you look at
  in the space under the flight controls, one at a time. Camera and joystick began as panels of
  their own toggled from the View menu, which put "point the camera" in a menu about window
  layout and had them competing with the pane for the same room. Two consequences worth
  keeping: a pane is mounted only while it is showing, so nothing that must outlive it can live
  in it — the joystick once did, and closing the pane dropped control, which is why its reading
  loop now belongs to the app; and a saved pane name is validated on load, because a name that
  no longer exists renders nothing at all with no clue in the tab strip.

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
  goes past, because the status feed is a capped ring the line scrolls out of. **And the banner
  is asked for rather than waited for** -- `MAV_CMD_DO_SEND_BANNER` (42428), sent on the first
  heartbeat beside the version request, which is what Mission Planner does and for the same
  reason. ArduPilot emits the banner once, at boot, so a GCS that attaches to a vehicle already
  running -- the normal case -- never heard it and drew a generic airframe for an aircraft that
  had said exactly what it was. Verified against SITL rather than assumed
  (`banner.integration.test.ts`): a simulator long past boot answers with
  `ArduCopter V4.7.1-beta1`, its board name, and `Frame: QUAD/PLUS` -- the line the latch reads.
  `KnownAirframe`
  grows one aircraft at a time and never by pattern: each entry needs a model this repo may
  ship, and a loose matcher would put the wrong aeroplane on someone else's screen.

- **3D models** (`src/models/`) are Betaflight Configurator's, unmodified, except `f35b.glb`,
  which is Lofted Aero's own CAD (STEP -> FreeCAD tessellation -> Blender decimate to ~5k
  triangles -> GLB) and so needs no in-app credit. Every model is authored to one convention
  -- span on X, nose toward +Y, up on Z, once a glTF importer has flattened it -- because both
  renderers apply the same rotation to whatever they load; check a new one against the biplane
  numerically rather than by eye. The biplane is
  CC-BY-4.0 and its credit must stay visible in the app (Overview, under the model), not just
  in the repo — see `src/models/ATTRIBUTION.md`. **A picture of a model is still the model**:
  the compass-calibration tiles are a sprite sheet pre-rendered from these files by
  `npm run cal-art`, and they carry the same credit line for the same reason. The quad is
  GPL-3.0, usable only because this app is GPL-3.0. Imported with `?url`; the demo build inlines them via `assetsInlineLimit`.
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

**A video stream reconnects by itself, and says why it is down** (`services/video.ts`,
`video-error.ts`). Measured in the built app against GStreamer: every failure the desktop side
reports is followed by a "Stopped", which the service treated as a clean stop and so wiped the
error the instant it arrived -- a refused connection, an unreachable camera and a stream killed
mid-flight all went silently back to Connect. The first report of an attempt is now the one
acted on; Node's codes read as the vehicle link's sentences ("Nothing is listening at …"); and
anything but a malformed request (bad scheme, not H.264, credentials, 401/403/404) retries at
1, 2, 4, then every 5 s until Disconnect -- a stream that goes silent while playing included,
since a camera that stops sending without closing its socket is the drop no event reports.
Killing and restarting the test source mid-stream comes back to "Playing" untouched. The
desktop side forwards a source's events only while it is the current one, or a stopped
stream's "Stopped" reaches the next attempt and reads as a drop.

**SITL gotcha that bit us twice:** it accepts exactly one TCP client and exits the moment that
client disconnects, so never probe the port to check readiness — watch stdout for the
`SERIAL0 on TCP port` banner instead (`waitForReady`). Every protocol feature must be demonstrated
against SITL before its phase closes — never trust the virtual FC alone. WSL2
`sim_vehicle.py` works too for UDP testing.
