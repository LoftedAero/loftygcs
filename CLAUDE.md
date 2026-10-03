# Lofty GCS: notes for AI coding agents

Cross-platform ArduPilot ground station: one React + TypeScript + Vite renderer shared by a
browser PWA, an Electron desktop app and an Android app (Capacitor). GPL-3.0.

## Read first

- `docs/architecture.md`: layering, subsystems, and the protocol, hardware and layout traps
  behind the code. It is imported at the end of this file, so it is always loaded.
- `docs/ui-conventions.md`: how screens in this app are composed (classes, tokens, layout).
- `docs/ux-rules.md`: the general UX rules, with a checklist to run on any new or changed
  screen.
- `docs/screen-review.md`: the per-screen review gate.
- `docs/releasing.md`: the release runbook. Follow it rather than reconstructing the process.
- `docs/android.md`: the Android app and the handheld hardware (AX12) it targets.

## Keeping the docs current

When work turns up something the next change needs to know, write it down in the same change:

- a protocol, firmware, hardware or layout trap, or a design decision: `docs/architecture.md`,
  in the section for that subsystem;
- a preference about how screens in this app are built: `docs/ui-conventions.md`;
- a UX rule that would hold in any app: `docs/ux-rules.md`.

State the fact and the reason briefly, not the story of how it was found. This file holds only
agent rules; keep it short.

## Rules that must not break

**Layering (ESLint-enforced).** `src/protocol` is environment-agnostic: no DOM, React,
Electron or Node imports, because it runs in a Web Worker and in plain Node. `src/transport`
may import from `protocol`, never from `ui`, `stores` or `services`. `src/ui` reaches the
protocol only through `src/worker/worker-client` and the stores (`protocol/types.ts` excepted).
High-rate telemetry never goes through React state.

**Design system.** Never edit `src/styles/lofted-aero.css`. It is vendored from Lofted Aero's
shared design system and must stay byte-identical (md5 `2f96f253a92dda2da2023d7330c4ea37`).
App styles go in `src/styles/app.css`, built only from `--la-*` tokens: no raw hex colors and
no raw pixel gaps. The only exceptions are definitions: app-local `--app-*` tokens and the dark
palette under `:root[data-theme='dark']`. Orange is the one primary action per region, blue is
working controls, green and red are status only.

**Electron security.** `contextIsolation` and `sandbox` stay on. `electron/preload.ts` is the
whole privileged surface and is mirrored by `src/types/loftgcs.d.ts`; change them together.

**Branding.** App identity lives only in `src/brand.ts`.

**No explanatory prose on screens.** A screen is controls. A `.la-hint` says the one thing the
user needs at that moment; reasons and background belong in code comments.

**Comments say why, briefly.** Not what the code does, and not its history.

**American English** in code, comments, UI strings and docs (color, behavior, canceled,
-ize). Third-party text and external identifiers keep their spelling (`MAV_RESULT_CANCELLED`).

**SITL is the acceptance target.** Every protocol feature is demonstrated against ArduPilot
SITL, not only against unit-test fakes. Run the SITL suite
against both Copter and Plane. Do not gate behavior on MAVLink capability bits; act on what an
operation actually answers.

**Hardware first.** When a bug involves attached hardware (serial bootloader, DFU, gamepads),
instrument and drive the real app (`LOFTGCS_DEBUG_SERIAL=1`, `LOFTGCS_DEBUG_USB=1`) before
explaining it from the code.

## File handling

- Use the Edit/Write tools for source files. Never round-trip a file through PowerShell
  `Get-Content`/`Set-Content`: it mangles UTF-8 (mojibake).
- Files are UTF-8 with LF line endings (`.gitattributes` enforces `eol=lf`). When scripting in
  Python, write with `newline='\n'`. After a scripted splice, check that the tail of the file
  survived.

## Tests and commands

These must all pass before work is done; CI runs them on push:

```
npm test
npm run typecheck
npm run lint
npm run format:check
```

Other checks, when the change touches their area:

- `NET=1 npm test`: live checks against ardupilot.org (parameter metadata paths).
- `SITL=1 npm test`: the integration suite against a running simulator. Start it first with
  `npm run sitl:fetch` (once) and `npm run sitl` (or `npm run sitl -- plane`). SITL serves one
  client, so do not start a second runner or probe port 5760; the suite runs files one at a
  time. `SITL_PORT` selects another port.
- `VIDEO=1 npm test`: the video client against GStreamer test sources
  (`npm run video:testsrc`, `npm run video:testsrc:udp`).
- `LOG_SWEEP=<dir> npx vitest run log-sweep.test.ts`: the log pipeline over real logs, after
  touching the log parser or log tools.

Development: `npm run dev` (browser), `npm run dev:electron` (desktop). Builds: `npm run dist`,
`npm run package:web`.

## Git

Commit or push only when asked. The version in package.json is the only thing distinguishing
one installer build from another; `docs/releasing.md` covers when to bump it.

@docs/architecture.md
