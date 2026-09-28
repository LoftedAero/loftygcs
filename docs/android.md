# The Android app (experimental)

The Android app is the web app inside [Capacitor](https://capacitorjs.com),
with one native plugin for the links a WebView cannot open:
`android/app/src/main/java/com/loftedaero/gcs/LinkPlugin.java` provides TCP,
UDP and UART links behind the same interface as the desktop app's Electron
bridge (`src/transport/native-link.ts`). Everything else is the shared web
build.

The first targets are Android handheld ground stations:

- **Radiomaster AX12** (Android 9, 1280×720 at density 1.75, so 732×412 for
  the app): MAVLink from the internal ELRS module on `/dev/ttyS1` at 460800
  baud. Choose Internal serial in the connection menu. The vendor's init
  scripts make the node world-writable, so no native code is needed to open
  it. Its WebView is Chrome 138, the last version for Android 9.
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
