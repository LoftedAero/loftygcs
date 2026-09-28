// The app's identity lives in this one file so a rename is a one-file change.
// The badge is a data URI so it renders the same over http and over file://
// in Electron. Keep it in sync with public/icons/icon.svg.
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
  /** Marks the build as a preview in the window. Set to false for a release. */
  preview: true,
  /** Where feedback goes. An empty string hides the feedback button. */
  feedbackEmail: 'info@loftedaero.com',
} as const
