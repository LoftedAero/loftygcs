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
  only from `--la-*` tokens — never a raw hex or pixel gap. Orange = the one primary action
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
- `npm run dist` — installers (3-OS matrix in CI via workflow_dispatch or v* tags)

## SITL (the acceptance target from Phase 1 on)

`npm run sitl:fetch` once (downloads the prebuilt Windows ArduCopter SITL that Mission
Planner uses, into gitignored `sitl/`), then `npm run sitl` to start it — it serves TCP on
127.0.0.1:5760 and waits for a GCS. `SITL=1 npm test` runs the integration suite against
it (`src/protocol/*.integration.test.ts`, `electron/sitl-core.test.ts`). The desktop app can
also install and run SITL itself — Overview > Simulator (`electron/sitl-core.ts`).

**SITL gotcha that bit us twice:** it accepts exactly one TCP client and exits the moment that
client disconnects, so never probe the port to check readiness — watch stdout for the
`SERIAL0 on TCP port` banner instead (`waitForReady`). Every protocol feature must be demonstrated
against SITL before its phase closes — never trust the virtual FC alone. WSL2
`sim_vehicle.py` works too for UDP testing.
