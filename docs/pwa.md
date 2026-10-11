# Use Lofty offline

After an initial online download, the browser app can reopen without internet
access. You no longer need to leave its tab open at the field.

## Prepare before leaving

1. Open the HTTPS-hosted app while online. On iPad, use Safari's Share → Add to
   Home Screen, then open that installed app while still online.
2. In Preferences, wait for **App ready offline**. Prepare the installed app
   itself; do not assume it shares storage with a browser tab.
3. In Plan, use **Offline maps** to download the field and check coverage with
   **Show stored tiles**. App readiness does not mean maps, terrain, firmware or
   vehicle metadata have been downloaded. Prepare each separately as needed.
4. Close Lofty and reopen it without internet access before relying on it.

Other browsers can use their Install app command or reopen the cached site.
Private browsing, limited storage or browser eviction can remove offline data.
If installation fails, restore internet access, check storage and choose Retry.
Clearing website data also removes the offline app and may erase maps/settings.

For a local telemetry connection, select WebSocket and use a trusted `wss://`
endpoint. Offline installation does not bypass certificate validation or
local-network permissions. Safari does not support Web Serial.

## Updates

Online launches check for updates. Once downloaded, Preferences shows
**Update saved. Close all app windows to apply.** Finish vehicle work and save
edits before closing every Lofty tab/window and reopening. Updates never force
a reload; an incomplete download leaves the previous app available.

See [MDN's offline PWA guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation#offline_operation)
for how service workers make offline startup possible. Hosting instructions
are in [releasing.md](releasing.md). Physical iPad installation, storage eviction
and real-device connections still require acceptance testing.
