# Packaging assets

`icon.png` is electron-builder's source icon — it generates the Windows
`.ico` and macOS `.icns` from this one file at build time. 512x512 with
transparent corners.

**It is generated, not drawn.** `public/icons/icon.svg` is the source of
truth; edit that and run:

```sh
npm run icon
```

Committed rather than built on demand because electron-builder reads it
before any of our scripts run, and because a missing icon does not fail a
build — it silently substitutes Electron's default, which is exactly the
kind of thing that reaches a tester unnoticed.

Both are placeholder art, per the note in the SVG.
