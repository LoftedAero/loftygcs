# Releasing

Builds ship through two channels: a hosted web app and downloadable
installers. They are produced differently, and only the web app can be built
for every platform from one machine.

## 1. Before either

1. Bump `version` in `package.json`. Bug reports refer to it, and the
   first-run notice reappears when it changes.
2. Check `src/brand.ts`. `preview` is `true` for a preview build and `false`
   for a release. `feedbackEmail` is published to everyone who gets a build;
   setting it to `''` removes the feedback button and address from the
   notice. `package.json`'s `author` and `build.deb.maintainer` carry the same
   address, and `dpkg -I` shows the maintainer to anyone who installs the
   `.deb`.
3. If `public/icons/icon.svg` changed, run `npm run icon` to regenerate
   `build/icon.png`. A missing or stale icon does not fail the build;
   electron-builder silently substitutes Electron's default.
4. Run `npm test && npm run lint && npm run typecheck`.
5. Walk [screen-review.md](screen-review.md) for every screen that changed
   since the last build, connected and disconnected.

## 2. The web app

The web app is served from Cloudflare Pages (project `lofty-gcs`) at
gcs.loftedaero.com. The manual CI run in section 3 builds and deploys it
alongside the installers, and uploads the zip to the draft release. Untick
"Build the installers" when starting the run to deploy only the web app.

Deploying needs two secrets in the repository's `production` environment:
`CLOUDFLARE_API_TOKEN` (a token with Account › Cloudflare Pages › Edit) and
`CLOUDFLARE_ACCOUNT_ID`. The environment allows deployments from `main` only,
so a pushed branch cannot use the token. Without the secrets the run builds
the zip and skips the deploy.

The custom domain is attached once in the Pages project, with a `gcs` CNAME to
the project's `pages.dev` address in the loftedaero.com DNS, which Wix hosts.
`public/_headers` lets the hashed assets be cached for good.

To build it by hand for another host:

```sh
npm run package:web        # -> dist/LoftyGCS_<version>_web.zip
```

Unzip it onto a static host. The host must meet two requirements:

- HTTPS. Web Serial is unavailable on insecure origins, and USB connection to
  a flight controller is the main reason for the web build. `localhost` is
  the only exception.
- A short cache lifetime for `index.html`. The hashed assets beside it can be
  cached indefinitely, but a cached entry document keeps users on the
  previous build after it has been replaced.

The build uses `base: './'`, so it works from a domain root or any subpath
without rebuilding.

## 3. Installers

Only CI builds all three platforms: a Windows machine cannot produce a
`.dmg`, and macOS builds need macOS.

The installer matrix runs manually only: Actions → CI → Run workflow. It is
not triggered by pushes or tags, because macOS runners bill at 10x and
Windows at 2x on private repositories. The Run workflow button appears only
once the workflow file is on the default branch. Lint, typecheck and tests
run on every push in a separate, Linux-only job.

The run creates a draft GitHub release, `v<version>`, and uploads the
installers, the Android APK (`Lofty-GCS-<version>-android.apk`) and the web zip
to it. The APK is signed with the release key from the repository's secrets, so
each one installs over the last; the job fails without the key rather than
ship an APK that cannot (`docs/android.md`, Signing). Review the draft, write the notes, and
publish it; publishing creates the tag. Files go to the release rather than to
workflow artifacts because artifacts count against the account's Actions
storage quota, which a few installer runs fill.

The version in `package.json` names the draft and every file, so bump it before
each run. Running again at the same version replaces the draft's files.

Files are named `LoftyGCS_<version>_<platform>...`, so they stay
distinguishable side by side.

### Building one platform locally

```sh
npm run dist               # installers for the current platform
```

On Windows this can fail with `EPERM: operation not permitted, rename
'dist\win-unpacked.tmp'`. Defender scans the freshly extracted Electron
binaries and holds them while electron-builder renames the directory. The
configuration is fine; the same build succeeds when writing outside the
repository:

```sh
npx electron-builder --win --publish never "-c.directories.output=$env:TEMP\lgcs-dist"
```

Alternatively, add the repository folder to Defender's exclusions once.

## 4. Publishing

Link [preview-testing.md](preview-testing.md) from the release notes or
include it alongside the files. It explains how to get past the SmartScreen
and Gatekeeper warnings, without which most reports about an unsigned build
are about the warning rather than the app.

## 5. Platform notes

### macOS: ad-hoc signing and no hardened runtime

The `mac` block sets `identity: "-"` (ad-hoc signing) and
`hardenedRuntime: false`. Both are required:

- arm64 binaries must carry at least an ad-hoc signature to run at all.
  electron-builder has no automatic fallback, so with `identity` unset the
  Apple Silicon build cannot launch.
- The hardened runtime enforces library validation, which rejects the
  pre-signed Electron framework when the app's ad-hoc signature has no Team
  ID.

Do not remove either setting. The build is also not notarized, which is why
macOS reports a downloaded copy as "damaged"; users get past it with System
Settings → Privacy & Security → Open Anyway.

### Linux: ship both formats, recommend the `.deb`

Both an AppImage and a `.deb` are built. On Debian and Ubuntu the `.deb` is
the better choice: its `postinst` checks whether unprivileged user namespaces
work and, only if they do not, sets the setuid bit on `chrome-sandbox`. That
is the situation on Ubuntu 24.04, where AppArmor restricts them.

An AppImage cannot do this, because squashfs cannot carry a setuid bit and
there is no install step. On those systems the AppImage fails the sandbox
check while the `.deb` works. The AppImage also needs `libfuse2`, which Ubuntu
has not installed by default since 22.04. It is provided for distributions
without `dpkg`.

Both formats have been verified to build and launch on Ubuntu under WSL, with
the right `.deb` metadata and `StartupWMClass` and with `sandbox: true`
intact. Behavior on Ubuntu 24.04 itself, the case the `postinst` handles, has
not yet been verified.

`desktopName` must be at the top level of `package.json`, not under
`build.linux`. electron-builder reads it from the package metadata, and the
schema rejects it inside the `linux` block. It becomes `StartupWMClass`, which
associates a running window with its launcher icon.

The app has no native Node modules (serial connections go through Web Serial
in Chromium rather than the `serialport` package), so there are no
per-platform prebuilds and no `electron-rebuild` step.

### Code signing

Nothing is signed, so:

- Windows shows "Windows protected your PC"; users click More info → Run
  anyway.
- macOS reports the app as damaged; users go to Privacy & Security → Open
  Anyway.
- Linux does not check.
- Android is the exception: the APK carries the release key, since Android
  requires every update to be signed by the same key as the installed app.

An OV certificate (about $200 to $400 a year) removes the Windows warning,
though a new certificate has to build SmartScreen reputation before it does
so reliably; an EV certificate works immediately and costs more. macOS needs
an Apple Developer membership ($99 a year) plus notarization in CI. Signing
becomes worthwhile when the click-through instructions cost more than they
save.
