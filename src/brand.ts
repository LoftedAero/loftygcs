// The app's identity lives in this one file so a rename is a one-file change.
// The badge is a data URI so it renders the same over http and over file://
// in Electron. It is public/icons/icon.svg with a white bezel, because the app
// bar is dark; keep the two marks in step.
const BADGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="26" fill="#4684C5"/>
  <path d="M6.79 38.36 L57.61 27.55 A26 26 0 0 1 6.79 38.36 Z" fill="#131417"/>
  <polygon points="27,14 35.5,14 30.9,36.5 44.5,36.5 43,44 21,44" fill="#F7941D"/>
  <circle cx="32" cy="32" r="28.25" fill="none" stroke="#FFFFFF" stroke-width="5.5"/>
</svg>`

export const BRAND = {
  name: 'Lofty GCS',
  tagline: 'Ground control for ArduPilot',
  iconPath: `data:image/svg+xml,${encodeURIComponent(BADGE_SVG)}`,
  repoUrl: 'https://github.com/LoftedAero/loftygcs',
  /** Marks the build as a preview in the window. Set to false for a release. */
  preview: true,
  /** Where feedback goes. An empty string hides the feedback button. */
  feedbackEmail: 'info@loftedaero.com',
} as const
