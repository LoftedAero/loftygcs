import { useThemeStore, type ThemeChoice } from '../../stores/theme-store'

// Light/dark, in the app bar because it applies to the whole window.
//
// One button rather than a three-way control: the common act is "make it
// the other one", and clicking that leaves an explicit choice, which is
// what someone who reached for the button wanted. Following the machine
// again is the rare case, so it is a shift-click and a title-bar mention
// rather than a third of the width.

const NEXT: Record<ThemeChoice, string> = {
  system: 'Following the system theme',
  light: 'Light theme',
  dark: 'Dark theme',
}

export default function ThemeToggle() {
  const choice = useThemeStore((s) => s.choice)
  const resolved = useThemeStore((s) => s.resolved)
  const toggle = useThemeStore((s) => s.toggle)
  const setChoice = useThemeStore((s) => s.setChoice)

  return (
    <button
      type="button"
      className="app-theme-toggle"
      title={`${NEXT[choice]} — click to switch, shift-click to follow the system`}
      aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`}
      onClick={(e) => (e.shiftKey ? setChoice('system') : toggle())}
    >
      {resolved === 'dark' ? <MoonIcon /> : <SunIcon />}
      {choice === 'system' && <span className="app-theme-toggle__auto" aria-hidden="true" />}
    </button>
  )
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="-12 -12 24 24" aria-hidden="true">
      <circle r="4.6" fill="currentColor" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <line
          key={a}
          x1="0"
          y1="-7.4"
          x2="0"
          y2="-9.8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          transform={`rotate(${a})`}
        />
      ))}
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="-12 -12 24 24" aria-hidden="true">
      {/* A crescent as one path: a filled disc with a second disc taken out
          of it, so it stays a crescent at any size rather than depending on
          two shapes lining up. */}
      <path
        d="M2.2 -8.6 A 8.6 8.6 0 1 0 6.4 5.6 A 6.9 6.9 0 0 1 2.2 -8.6 Z"
        fill="currentColor"
      />
    </svg>
  )
}
