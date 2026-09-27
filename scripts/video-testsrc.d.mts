// The live video test resolves GStreamer the same way the script does, rather
// than keeping a second copy of the search paths that would quietly drift.
// Only the helper is typed; the rest of the script is a CLI.

/** The bin/ directory holding gst-launch-1.0, '' if it is on PATH, or null. */
export function findGstreamer(): string | null
