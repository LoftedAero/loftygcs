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
  Mission, Simulator — switched from the app bar; only Setup has the tab rail, and the others
  (plus a running guide) take the whole window. The rail order is the bring-up sequence, and Ports
  deliberately precedes Sensors because SERIALn_PROTOCOL gates compass/GPS detection.
  The mode switch is never orange: Connect owns the app bar's one primary action.
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
- **High-rate telemetry** never goes through React state — ring buffers + rAF reads
  (arrives in Phase 1).
- **American English** everywhere — code, comments, UI strings, docs (color, behavior,
  centered, labeled, canceled, -ize verbs). Third-party text is the exception and stays
  verbatim: the GPL LICENSE, dependency names, and identifiers from external specs (MAVLink's
  own `MAV_RESULT_CANCELLED` keeps its spelling; only our rendered label is Americanized).
- **3D models** (`src/models/`) are Betaflight Configurator's, unmodified. The biplane is
  CC-BY-4.0 and its credit must stay visible in the app (Overview, under the model), not just
  in the repo — see `src/models/ATTRIBUTION.md`. The quad is GPL-3.0, usable only because this
  app is GPL-3.0. Imported with `?url`; the demo build inlines them via `assetsInlineLimit`.
- Comments say *why*, not what.

## Commands

- `npm run dev` / `npm run dev:electron` — browser / desktop development
- `npm test`, `npm run typecheck`, `npm run lint` — all three must pass; CI runs them on push
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
also install and run SITL itself — Overview > Simulator (`electron/sitl-core.ts`).

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
