# Contributing to Loft GCS

Thanks for your interest in Loft GCS. Bug reports, fixes and new features are
welcome. For anything larger than a small fix, please open an issue first so
the approach can be discussed before you start.

## Setup

You need Node.js 22 or later.

```sh
npm install
npm run dev            # browser build at the printed URL
npm run dev:electron   # desktop app against the same dev server
```

With no flight controller attached, choose Demo in the connection menu to get
a simulated vehicle.

## Checks

These three must pass before a pull request is merged, and CI runs them on
every push:

```sh
npm test
npm run typecheck
npm run lint
```

`NET=1 npm test` also runs live checks against ardupilot.org, such as the
parameter metadata paths.

## Testing against SITL

The demo vehicle is a stand-in, not ArduPilot. Every protocol feature must
also be demonstrated against ArduPilot SITL:

```sh
npm run sitl:fetch       # once: download the prebuilt Windows Copter SITL into sitl/
npm run sitl:fetch -- plane   # once: the Plane build as well
npm run sitl             # serve a Copter on 127.0.0.1:5760
npm run sitl -- plane    # or a Plane
SITL=1 npm test          # run the integration tests against it
```

SITL accepts one client at a time, so the integration tests run one file at a
time when `SITL=1` is set. Run the suite against both Copter and Plane: the
two vehicles differ in parameters, commands and takeoff behavior, and a test
that passes on one can fail on the other. On macOS and Linux, run ArduPilot's
`sim_vehicle.py` and point the tests at it.

For UI changes, also run the [screen review checklist](docs/screen-review.md)
for each screen you touched, connected and disconnected.

## Code style

- TypeScript in strict mode.
- Format with Prettier (`npm run format`); the configuration is
  in `.prettierrc`.
- American English everywhere: code, comments, UI strings and docs.
  Identifiers from external specs keep their original spelling.
- Comments explain why, not what.
- UI text is short. A screen shows controls and labels; explanations belong
  in code comments.

## Architecture rules

The layering is enforced by ESLint:

- `src/protocol` is environment-agnostic. It has no DOM, React, Electron or
  Node imports, because it runs in a Web Worker and in plain Node for tests.
- `src/transport` may import from `src/protocol`, but never from the UI,
  stores or services.
- `src/ui` reaches the protocol only through `src/worker/worker-client` and
  the stores.

Electron runs with `contextIsolation` and `sandbox` enabled. The whole
privileged surface is `electron/preload.ts`, mirrored by
`src/types/loftgcs.d.ts`; change them together.

High-rate telemetry does not go through React state. It is read from ring
buffers on animation frames.

## Styles

`src/styles/lofted-aero.css` is a vendored design-system stylesheet shared
with other projects and must not be edited here. App styles go in
`src/styles/app.css`, built from the `--la-*` tokens rather than raw colors or
pixel values. App-local `--app-*` tokens and the dark theme palette are the
only places new values are defined.

For UI work, read:

- [docs/ux-rules.md](docs/ux-rules.md): general UX guidelines, with a
  checklist to run before submitting a screen
- [docs/ui-conventions.md](docs/ui-conventions.md): how screens in this app
  are built, and the classes and tokens that implement each convention

[docs/architecture.md](docs/architecture.md) covers each subsystem and the
ArduPilot behaviors the code depends on. Read the relevant section before
changing a subsystem.

## Pull requests

- Keep each pull request focused on one change.
- Include tests for new behavior. Protocol changes need a SITL integration
  test where practical.
- Describe how you verified the change: which tests, which vehicle, and
  whether it ran against SITL or hardware.
- For UI changes, include screenshots in both light and dark themes.

## Reporting bugs

Open an issue at <https://github.com/LoftedAero/loftgcs/issues>. Include:

- what you did, and what you expected to happen
- the app version (shown in the bottom right of the window)
- your operating system, and whether you used the browser or desktop build
- the vehicle type and firmware version, if hardware was connected
- screenshots or logs where they help

Please report security issues privately to info@loftedaero.com rather than in
a public issue.

## License

Loft GCS is licensed under the GNU General Public License v3.0 only (see
[LICENSE](LICENSE)). By contributing, you agree that your contributions are
licensed under the same terms. Code ported from other GPL projects keeps its
attribution in the file header.
