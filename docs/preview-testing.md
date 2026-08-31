# Trying the Loft GCS preview

Thanks for taking a look. This is an unfinished build — the point of handing
it out is to find what is wrong with it, so nothing you report is too small.

**Before anything else:** this station arms motors, changes flight modes,
writes parameters and can flash firmware. All of it has been tested against
ArduPilot's own simulator; **none of it has been flown**. Do not put an
aircraft you care about in the air on this build, and do not flash a board
you cannot recover with a bootloader.

---

## Which one do you want?

There are two ways in, and they can do different things.

| | In a browser | Desktop app |
|---|---|---|
| Install needed | none | yes |
| USB flight controller | **yes** (Chrome, Edge, Opera) | yes |
| TCP / UDP telemetry | no | **yes** |
| Built-in ArduPilot simulator | no | **yes** |
| Video in the HUD | no | **yes** |
| Demo mode, missions, parameters, OSD | yes | yes |

If you have a flight controller and a USB cable, the browser version is the
fastest way to be useful — it connects to real hardware with nothing
installed. If you want to fly the built-in simulator, receive telemetry over
a network radio, or try camera video, you need the desktop app.

Firefox and Safari cannot talk to USB devices at all; in those, only demo
mode works.

---

## The browser version

Open the link you were sent. That is the whole procedure.

To connect a board: plug it in, choose **USB serial**, press **Connect**, and
pick the port from the browser's chooser. If nothing is listed, the board is
either not powered or is being held by another program — Mission Planner and
QGroundControl keep the port open while they are running, so close them
first.

---

## The desktop app

The installers are **not code-signed**, which means Windows and macOS will
both object. They are not objecting to anything they found in the file; they
object because nobody has paid to vouch for it. Here is how to get past each.

### Windows

1. Run `LoftGCS_<version>_windows_setup.exe`.
2. A blue box appears: *"Windows protected your PC"*.
3. Click **More info**, then **Run anyway**.

It installs for the current user only — no administrator prompt, and nothing
outside your own profile is touched.

### macOS

1. Open the `.dmg` and drag **Loft GCS** to Applications. Take the
   `arm64` file for Apple Silicon (M1 and later) and `x64` for Intel.
2. Launching it normally reports that the app *"is damaged and can't be
   opened"*. It is not damaged — that is what macOS says about software it
   cannot verify.
3. Open Terminal and run:

   ```sh
   xattr -dr com.apple.quarantine "/Applications/Loft GCS.app"
   ```

4. It opens normally from then on.

### Linux

```sh
chmod +x LoftGCS_<version>_linux_x86_64.AppImage
./LoftGCS_<version>_linux_x86_64.AppImage
```

If the flight controller is not listed, your user is probably not in the
`dialout` group:

```sh
sudo usermod -aG dialout "$USER"   # then log out and back in
```

---

## Where to start

If you have twenty minutes and no hardware, this is the useful path:

1. **Start demo mode** on the Overview screen. A simulated vehicle appears,
   arms itself and starts flying — every screen works from here.
2. **Fly** — the HUD and map. Try the layout controls under `View ▾`,
   right-click the HUD, right-click the map.
3. **Mission** — press *Read vehicle*, drag a waypoint, add one with the
   palette above the map, change a row's command in the table.
4. **Setup ▸ Parameters** — search, edit, and notice what happens when you
   do. (Nothing is written until you press *Write Params*.)

With a flight controller, the parts most worth exercising are **Setup ▸
Radio** and **Setup ▸ Sensors** — the calibration flows are the ones designed
to be better than what you are used to, so they are the ones where being
told "this is confusing" is most valuable.

The desktop app can also run a real ArduPilot simulator for you: **Simulator
▸ Install**, then **Start**, then connect over TCP to `127.0.0.1:5760`.

---

## What is missing, so you don't report it

- **Log download and analysis** is not built — the Logs tab is a placeholder.
- **Geofences and rally points** are not in the mission editor yet.
- **Survey and grid patterns** are not built.
- **The app does not update itself.** You will be sent a new build.
- Firmware flashing is written but has never run against a real board.

---

## What to send back

Anything. Confusion counts as a bug — if you could not find something, that
is a finding, not a failure on your part.

Useful to include when something breaks:

- what you were doing, and what you expected instead
- the build version (bottom right of the window, next to the amber
  **Preview** chip)
- your OS, and whether you were in the browser or the desktop app
- what vehicle and firmware, if hardware was connected

Screenshots are worth a lot, particularly for anything about layout or
wording.
