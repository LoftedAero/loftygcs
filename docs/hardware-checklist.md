# Hardware validation checklist

What SITL and the virtual FC cannot prove. Run with a bench vehicle (props off) and, for
the flashing section, ideally a sacrificial board first. Check items off per release.

## Connect + telemetry (closes Phase 1)

- [ ] **Web Serial, browser**: `npm run dev`, open in Chrome/Edge, plug the FC in over USB,
      Connect → picker shows the board → heartbeat + live telemetry on Welcome.
- [ ] **Web Serial, desktop**: `npm run dev:electron`, same flow — the port chooser is the
      app's own modal (house style), not a browser sheet.
- [ ] **Unplug mid-session**: pull USB while connected → app reports the link closed and
      returns to idle; reconnect works without a restart.
- [ ] **Telemetry radio**: connect through a SiK/ELRS serial radio; check the link stats
      (msg/s, dropped bytes) look sane at radio rates.
- [ ] **UDP**: WiFi bridge or `--out udp:<pc>:14550` from SITL/vehicle → Listen on UDP 14550
      connects.

## Parameters (closes Phase 2)

- [ ] Full parameter table loads from the real board; note whether the source was MAVFTP
      (fast) or the stream fallback, and how long it took.
- [ ] Change a harmless param (e.g. `LOIT_SPEED_MS`), Write Params, power-cycle, reconnect —
      the new value persisted.
- [ ] Export the params, factory-wipe nothing, re-Import the file — diff stages cleanly.

## Setup (closes Phase 3)

- [ ] Accel calibration wizard end-to-end on the bench (six positions, success reported).
- [ ] Compass calibration outdoors — progress climbs, report accepted, offsets sane.
- [ ] Radio calibration with the real transmitter — endpoints captured, RCn_MIN/MAX/TRIM
      written, bars track sticks live.
- [ ] Motor test (props off!): each motor spins on command, Stop all stops, the interlock
      modal gates the card.

## Firmware flashing (closes Phase 4) — sacrificial board first

Serial bootloader path:
- [ ] Desktop app: manifest loads; pick vehicle/channel/board; Download firmware succeeds
      and shows the right board id.
- [ ] Connected vehicle → "Reboot vehicle to bootloader" → port re-enumerates.
- [ ] "Select port and flash": bootloader identified; **wrong-board .apj is refused before
      erase** (test this deliberately with a mismatched board's firmware).
- [ ] Correct .apj: erase → program (progress) → **CRC verified** → reboot → reconnect and
      confirm the new version in Messages at boot.
- [ ] Kill the app mid-program, power-cycle, flash again — recovers (the bootloader is
      untouched by design).
- [ ] Browser build: same flash from Chrome with a manually loaded .apj.

DFU recovery path:
- [ ] Board with BOOT0 held enumerates; on Windows, confirm the WinUSB driver situation
      (Zadig) and write down what a customer would need to do.
- [ ] "Download with bootloader" fetches the matching `_with_bl.hex`.
- [ ] DFU flash completes (erase sectors → program → leave) and the board boots ArduPilot
      with a working bootloader afterwards.
- [ ] Wrong image caution: confirm the modal warning reads right — DFU cannot check board
      id, so this path is deliberately scarier.

## Guided setups

- [ ] Run the generic "Multirotor first setup" guide against the bench vehicle end to end.
- [ ] F-35B guide with the real airframe once the true baseline/output map is filled in.
