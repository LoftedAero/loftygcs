// The app's identity lives in this one file so a rename is a one-file change.
// "Loft GCS" is a working name -- check for trademark/name collisions before
// the first public release.
// The badge ships as a data URI so it renders in every home the one build
// has to serve -- http, file:// in Electron, and the single-file demo
// artifact, where a relative asset path has nothing to resolve against.
// Keep it in sync with public/icons/icon.svg (the favicon/PWA copy).
const BADGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="29" fill="#FFFFFF" stroke="#4684C5" stroke-width="4"/>
  <path d="M32 14 L46 42 L32 35 L18 42 Z" fill="#F7941D"/>
  <rect x="20" y="46" width="24" height="4" rx="2" fill="#2D2D2F"/>
</svg>`

export const BRAND = {
  name: 'Loft GCS',
  tagline: 'Ground control for ArduPilot',
  iconPath: `data:image/svg+xml,${encodeURIComponent(BADGE_SVG)}`,
  repoUrl: 'https://github.com/LoftedAero/loftgcs',
} as const
