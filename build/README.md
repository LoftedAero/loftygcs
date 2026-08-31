# Packaging assets

`icon.png` is electron-builder's source icon — it generates the Windows
`.ico` and macOS `.icns` from this one file at build time. 512x512 with
transparent corners, rasterised from `public/icons/icon.svg`, which stays
the source of truth: regenerate this rather than editing it, so the app
icon and the favicon cannot drift apart.

Both are placeholder art, per the note in the SVG.
