# Installing and testing Lofty GCS

This guide covers installing a Lofty GCS build, getting past the warnings an
unsigned build triggers, and reporting what you find.

Lofty GCS can arm motors, change flight modes, write parameters and flash
firmware. Preview builds are early builds shared for feedback, and have yet to
be fully validated in the real world:

- Use caution when operating a vehicle. Maintain the ability to disconnect and
  take manual control.
- If flashing firmware, use a board you are willing to recover with a
  bootloader if necessary.
- Keep saved backups of any parameter configurations you rely on.

## Builds and channels

Builds come in two forms:

- The web app at <https://gcs.loftedaero.com>, which runs in the browser with
  nothing to install.
- Desktop installers for Windows, macOS and Linux.
- An Android app (experimental) for handheld ground stations such as the
  RadioMaster AX12.

Preview builds are marked with an amber Preview chip next to the version
number in the bottom right of the window. They are development snapshots and
change often. Release builds carry no chip. Installers are published on the
project's GitHub Releases page.

The app does not update itself. To move to a newer build, download and
install it over the old one.

## Browser, desktop or Android

|                              | Browser                                 | Desktop app   | Android app |
| ---------------------------- | --------------------------------------- | ------------- | ----------- |
| Install needed               | no                                      | yes           | yes         |
| USB flight controller        | yes (Chrome, Edge, Opera, Firefox 151+) | yes           | no          |
| Firmware flashing            | yes (DFU in Chrome, Edge, Opera only)   | yes           | no          |
| WebSocket telemetry          | yes                                     | yes           | yes         |
| TCP / UDP telemetry          | no                                      | yes           | yes         |
| The radio's internal serial  | no                                      | no            | yes (AX12)  |
| Built-in ArduPilot simulator | no                                      | yes (Windows) | no          |
| Video in the HUD             | no                                      | yes           | no          |
| Missions, parameters, OSD    | yes                                     | yes           | yes         |
| Voice callouts               | yes                                     | yes           | yes         |

If you have a flight controller and a USB cable, the browser version is the
quickest way to start. For the built-in simulator, a network telemetry radio,
or camera video, use the desktop app. Safari cannot talk to USB devices, so
only WebSocket connections work there.

## The browser version

Open <https://gcs.loftedaero.com>. To connect a board, plug it in, choose USB
serial in the connection menu, press Connect, and pick the port from the
browser's chooser.

If no port is listed, the board is either unpowered or held by another
program. Mission Planner and QGroundControl keep the port open while they are
running, so close them first.

## The desktop app

The installers are not code-signed, so Windows and macOS warn before running
them. The warning means the file is unsigned, not that anything was found in
it. The steps below get past it on each platform.

### Windows

1. Run `LoftyGCS_<version>_windows_setup.exe`.
2. When "Windows protected your PC" appears, click More info, then Run anyway.

The installer asks whether to install for you only or for everyone on the
computer. For you only needs no administrator rights and installs under your
profile; for everyone installs to `C:\Program Files\Lofted Aero\Lofty GCS`.

### macOS

1. Open the `.dmg` and drag Lofty GCS to Applications. Use the `arm64` file for
   Apple Silicon (M1 and later) and the `x64` file for Intel Macs.
2. The first launch reports that the app "is damaged and can't be opened".
   This is how macOS describes an app that is not notarized; the app is not
   damaged.
3. Open System Settings, go to Privacy & Security, scroll down, and click Open
   Anyway. Then launch the app again.

Alternatively, from a terminal:

```sh
xattr -dr com.apple.quarantine "/Applications/Lofty GCS.app"
```

### Linux

Two packages are provided. On Debian and Ubuntu, use the `.deb`:

```sh
sudo apt install ./LoftyGCS_<version>_linux_amd64.deb
lofty-gcs
```

It installs to `/opt`, puts `lofty-gcs` on your `PATH`, and adds an application
menu entry.

On other distributions (Fedora, Arch, openSUSE), use the AppImage:

```sh
chmod +x LoftyGCS_<version>_linux_x86_64.AppImage
./LoftyGCS_<version>_linux_x86_64.AppImage
```

Two AppImage problems the `.deb` avoids:

- "dlopen(): error loading libfuse.so.2": AppImages need FUSE 2, which Ubuntu
  22.04 and later do not install by default. Install it with
  `sudo apt install libfuse2`, or run the AppImage with
  `--appimage-extract-and-run`.
- "The SUID sandbox helper binary was found, but is not configured
  correctly": Ubuntu 24.04 and later restrict unprivileged user namespaces,
  and an AppImage cannot ship the sandbox helper with the permissions needed
  to work around that. The `.deb` sets this up at install time. As a last
  resort, `--no-sandbox` starts the AppImage, at the cost of running the
  browser engine without its sandbox.

#### Serial ports on Linux

If your flight controller does not appear, add yourself to the `dialout`
group, then log out and back in:

```sh
sudo usermod -aG dialout "$USER"
```

If it still does not appear and the board uses a CH340 or CP2102 adapter,
check whether `brltty` has claimed it. On Ubuntu it grabs some USB serial
adapters, mistaking them for braille displays. `sudo apt remove brltty` is the
usual fix.

Chromium installed as a snap runs in its own sandbox and may not see serial
devices. If the browser version cannot list ports but the desktop app can,
this is the likely cause.

## The Android app

The Android app is experimental. It needs Android 7 or later and is aimed at
handheld ground stations with a built-in radio link.

1. Download `Lofty-GCS-<version>-android.apk` from the release.
2. Open it on the device. Android asks you to allow installs from whichever app
   opened it (the browser or the file manager); allow it, then Install.
3. To update, install the newer APK over the old one. Settings and downloaded
   maps are kept.

A system update on the RadioMaster AX12 uninstalls the app; install it again
afterwards.

To connect on the AX12, put the ELRS module and receiver in MAVLink mode, set
the ELRS Backpack's Telemetry to WiFi, join the `ExpressLRS TX Backpack`
network on the radio (password `expresslrs`), and connect over UDP, listening
on port 14550. On a SIYI UniRC 10 Pro, set SIYI's datalink to UDP and connect
over UDP. [android.md](android.md) has the details for each radio.

On a screen this small the app uses its compact layout. Preferences, opened
from the logo, can choose the layout and the voice callouts.

## Where to start

Without hardware:

1. In the desktop app on Windows, open the SITL tray in the app bar and start
   a simulator. It connects on its own, and every screen becomes available.
2. Fly: the HUD and map. Try the layout options in the View menu, and
   right-click the HUD and the map.
3. Plan: press Read from vehicle, drag a waypoint, add one from the palette on
   the map, and change a row's command in the table.
4. Setup > Parameter List: search and edit. Nothing is sent to the vehicle
   until you press Write.

With a flight controller, Setup > Radio and Setup > Sensors are the most
useful screens to exercise. Reports that a calibration flow is confusing are
especially helpful.

### The built-in simulator (desktop, Windows)

The desktop app can download and run ArduPilot SITL. Open the SITL tray in the
app bar, click Install simulator, then Launch SITL instance; the app connects
to it automatically. The dot on the SITL button stays lit while a simulator is
running.

The tray also accepts your own setup:

- Build: the official release, or your own SITL executable. The vehicle type
  and firmware version are read from the binary.
- Physics: the built-in model, or RealFlight. RealFlight must have
  Simulation > Settings > Physics > "RealFlight Link enabled" turned on.
- Parameters: wipe to defaults, keep what the last session stored, or load a
  `.parm` file or a saved `eeprom.bin`. A supplied EEPROM is copied, so the
  original file is never modified.
- Home location: pick the flying field and runway heading on a map.

These settings are remembered between sessions.

On macOS and Linux, run ArduPilot's `sim_vehicle.py` and connect over TCP or
UDP.

## Reporting issues

Open an issue at <https://github.com/LoftedAero/loftygcs/issues>, or email
info@loftedaero.com. On preview builds, the Send feedback button in the
first-run notice starts an email with the build and platform filled in.

Confusing behavior counts as a bug. If you could not find something, that is
worth reporting.

When something breaks, include:

- what you were doing, and what you expected to happen
- the build version (bottom right of the window)
- your operating system, and whether you used the browser, the desktop app or
  the Android app (with the device's model)
- the vehicle type and firmware version, if hardware was connected

Screenshots help, especially for layout or wording problems.
