# The Android app (experimental)

The Android app is the web app inside [Capacitor](https://capacitorjs.com),
with one native plugin for the links a WebView cannot open:
`android/app/src/main/java/com/loftedaero/gcs/LinkPlugin.java` provides TCP,
UDP and UART links behind the same interface as the desktop app's Electron
bridge (`src/transport/native-link.ts`). Everything else is the shared web
build.

The first targets are Android handheld ground stations:

- **Radiomaster AX12** (Android 9, 1280×720 at density 1.75, so 732×412 for
  the app). Its WebView is Chrome 138, the last version for Android 9.
  - **MAVLink goes through the ELRS TX Backpack's WiFi.** Put the ELRS
    module and receiver in MAVLink mode, set the Backpack's Telemetry to
    WiFi, join the `ExpressLRS TX Backpack <id>` network (password
    `expresslrs`) and connect over UDP, listening on 14550. The Backpack
    (10.0.0.1) broadcasts to the subnet until it hears from the GCS, then
    replies to it; its `http://10.0.0.1/mavlink` page shows counters both
    ways. The network without an id suffix is the firmware-update service,
    which forwards nothing. On Backpack 1.5.4 the Telemetry setting only took
    effect when switched Off and back to WiFi, which the 1.5.8 C3 fix
    addresses.
  - **`/dev/ttyS1` only receives on the unit we tested.** Radiomaster's
    release notes call it full duplex at 460800, and telemetry does arrive
    there (Internal serial in the connection menu). Nothing written to it
    reaches the aircraft, from Lofty GCS or from Radiomaster's own QGC build.
    Its transmit pin (GPIO47, correctly muxed as UART1 TX) reads low only
    15–20% of the time while zeros are streamed, where 90% is expected:
    something on the board holds the line high. Reported to Radiomaster.
  - The module forwards MAVLink to that port only with its Link Mode set to
    MAVLink, and ELRS accepts that change only while no receiver is
    connected. With a receiver linked, Radiomaster's ELRS page accepts the
    choice but keeps showing Normal. Power the receiver off (including the
    flight controller's USB) before changing it. The receiver's Serial
    Protocol must be MAVLink as well, with `SERIALn_PROTOCOL` 2 and
    `SERIALn_BAUD` 460 on the flight controller.
  - ELRS 333 Hz Full carries about 46 messages a second and answers in
    about 0.5 s; 150 Hz, about 10 and 2.5 s. See Slow links in
    `docs/architecture.md`.
  - Android 9's toybox `stty` scrambles the input flags when given `-echo`
    (XON/XOFF, case folding and parity marking come on), so `LinkPlugin`
    passes `-echo` before `raw`, which rewrites them.
  - `/proc/tty/driver/serial` counts each UART's bytes and is the quickest
    way to see whether anything is arriving; the counts reset when the port
    is opened. `/sys/devices/platform/1000b000.pinctrl/mt_gpio` shows each
    pin's mode and level.
  - Closing `/dev/ttyS1` can wedge the MediaTek UART driver: the closing
    process sticks in `mtk_dma_terminate_all`, and every later open, `stty`
    or read of `/proc/tty/driver/serial` hangs until the radio reboots. It
    has followed force-stopping the app mid-session and a shell bridge
    exiting. Check for a stuck process before blaming the link.
  - The radio's AT32 coprocessor owns sticks, switches and the ELRS module's
    CRSF line, and talks to Android over `/dev/ttyS0` (921600) with a
    proprietary protocol, documented by the independent
    [ax12-research](https://github.com/rmeadomavic/ax12-research) project.
    The top USB-C port is the AT32's own serial port and HID joystick.
- **SIYI UniRC 10 Pro** (Android 13): MAVLink over UDP. Set the datalink's
  connection type to UDP in SIYI's settings; the app then sends to
  192.168.144.20:19856.

## Building

Needs JDK 21 and the Android SDK (platform 36). Point Gradle at the SDK with
`android/local.properties` (`sdk.dir=C:/path/to/sdk`, forward slashes), which
is not committed.

```sh
npm run build:web
npx cap sync android
cd android
./gradlew assembleDebug        # gradlew.bat on Windows
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The app runs full screen and keeps the screen on (`MainActivity.java`).

## Testing without a vehicle

`adb reverse tcp:5760 tcp:5760` forwards the device's port 5760 to the
computer, so the app can connect over TCP to `127.0.0.1:5760` while
`npm run sitl` runs on the computer.
