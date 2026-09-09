# Cutting a preview build

Preview builds go out through two channels: a hosted web app and downloadable
installers. They are produced differently, and only one of them can be made
on a laptop.

## 0. Before either

1. Bump `version` in `package.json`. Testers report against it, and the
   first-run notice reappears when it changes — which is the point, since a
   new build makes new claims.
2. Check `src/brand.ts`: `preview` must be `true`. `feedbackEmail` is
   `info@loftedaero.com` — the company address rather than anyone's personal
   one, because it is published to everyone who gets a build. Setting it to
   `''` removes the button and the address from the notice entirely.
   `package.json`'s `author` and `build.deb.maintainer` carry the same
   address; `dpkg -I` shows the maintainer to anyone who installs the `.deb`.
3. If `public/icons/icon.svg` changed, `npm run icon` to regenerate
   `build/icon.png`. A missing or stale icon does not fail a build —
   electron-builder quietly substitutes Electron's default.
4. `npm test && npm run lint && npm run typecheck`.
5. Walk `docs/screen-review.md`. Every screen is looked at **connected and
   disconnected** — they are two different screens, and the disconnected one
   is the one a new tester sees first. Ticks are per screen and survive
   between releases; re-approve anything that changed since its last one.

## 1. The web app

```sh
npm run package:web        # -> dist/LoftGCS_<version>_web.zip
```

Unzip into whatever static host you are using. Two requirements the host has
to meet:

- **HTTPS.** Web Serial does not exist on an insecure origin, and connecting
  a flight controller over USB is the whole reason the web channel is worth
  having. `localhost` is exempt; nothing else is.
- **Do not cache `index.html` for long.** The hashed assets beside it can be
  cached forever, but if the entry document is cached, testers keep loading
  the previous build after you have replaced it, and report bugs you already
  fixed.

The build uses `base: './'`, so it works from a domain root or any subpath
without rebuilding.

## 2. Installers

Only CI can build all three platforms — a Windows machine cannot produce a
`.dmg`, and macOS builds need macOS.

**The matrix runs by hand only.** Actions tab → *CI* → **Run workflow**.
Nothing triggers it automatically: while the repo is private, macOS minutes
bill at 10× and Windows at 2×, so a matrix that fires on every tag or push is
a bill for commits that changed a comment. (The button only appears once the
workflow file is on the default branch.)

When the run finishes, download the `windows`, `macos` and `linux` artifacts
from it. Each is a zip *around* the real files, so unwrap them before
uploading anywhere. Artifacts expire after 90 days — once they are on the
file host that stops mattering.

Because nothing is tagged, **the version in `package.json` is the only record
of which build is which.** Bump it before every run, or two downloads will
claim to be the same build and testers will report against the wrong one.
Tagging afterwards is still worth doing for your own history — it just no
longer triggers anything.

The files are named `LoftGCS_<version>_<platform>...`, so they stay
distinguishable once they are sitting in a folder next to each other.

### Building one platform locally

```sh
npm run dist               # the platform you are standing on
```

**Known problem on Windows:** this fails with `EPERM: operation not
permitted, rename 'dist\win-unpacked.tmp'`. Defender scans the freshly
extracted Electron binaries and holds them while electron-builder tries to
rename the directory. It is not a configuration fault — the same build
succeeds writing anywhere outside the repository:

```sh
npx electron-builder --win --publish never "-c.directories.output=$env:TEMP\lgcs-dist"
```

Adding the repo folder to Defender's exclusions fixes `npm run dist` itself,
if you would rather do that once.

## 3. What to send with the download

Put `docs/preview-testing.md` beside the files, or paste it into whatever
message carries the links. It is written for the tester, and it is the thing
that gets them past the SmartScreen and Gatekeeper warnings — an unsigned
build with no instructions mostly produces "it says it's damaged" replies
rather than feedback about the app.

## 4. Platform notes worth not rediscovering

### macOS: `identity: "-"` is load-bearing

The `mac` block ad-hoc signs, and `hardenedRuntime` is off. Neither is
cosmetic, and this is the same conclusion 3BSM_Config reached the hard way:

- **arm64 binaries must carry at least an ad-hoc signature to execute at
  all.** electron-builder has no automatic fallback, so an unset `identity`
  produces an Apple Silicon build that simply cannot launch.
- **`hardenedRuntime` enforces library validation**, which rejects the
  pre-signed Electron framework when an ad-hoc signature carries no Team ID.

So do not "tidy" either of them. Not being notarized is separate, and is why
a downloaded build reports itself as *damaged*; the way past is System
Settings → Privacy & Security → Open Anyway.

### Linux: ship both, and prefer the `.deb`

Both formats are built. The `.deb` is the better one on Debian and Ubuntu for
a specific reason: its `postinst` tests whether unprivileged user namespaces
work and, only if they do not, sets the setuid bit on `chrome-sandbox`. That
is exactly the situation on Ubuntu 24.04, where AppArmor restricts them.

An AppImage cannot do this — squashfs cannot carry a setuid bit and there is
no install step to run — so on those systems it fails the sandbox check while
the `.deb` works. It also needs `libfuse2`, which Ubuntu stopped installing
by default at 22.04. The AppImage is there for distributions without `dpkg`,
not as the recommended path.

Verified in WSL Ubuntu: both formats build, the `.deb` carries the right
metadata and `StartupWMClass`, and the app launches with `sandbox: true`
intact. Not verified: behavior on 24.04 specifically, which is the case the
`postinst` exists to handle.

`desktopName` sits at the **top level** of package.json, not under
`build.linux` — electron-builder reads it from the package metadata, and the
schema rejects it inside the `linux` block. It becomes `StartupWMClass`,
which is what makes a running window associate with its launcher icon.

Unlike 3BSM_Config, this app has **no native modules** — connections go
through Web Serial in Chromium rather than the `serialport` package — so
there is no per-platform prebuild to worry about and no `electron-rebuild`
step. That is why these builds are less fragile than that project's.

### Signing, when it is worth it

Nothing is signed, so:

- **Windows** shows *"Windows protected your PC"* — More info → Run anyway.
- **macOS** claims the app *"is damaged"* — Privacy & Security → Open Anyway.
- **Linux** does not care.

An OV certificate (~$200–400/yr) removes the Windows warning, though a new
certificate still has to accumulate SmartScreen reputation before it does so
reliably; EV works immediately and costs more. macOS needs Apple Developer
at $99/yr plus notarization in CI. Worth buying when the click-through
instructions start costing more feedback than they are saving — not before.
