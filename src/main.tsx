import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// The design system loads before the app sheet so app rules win without !important.
import './styles/lofted-aero.css'
import './styles/app.css'
import { watchSystemTheme } from './stores/theme-store'
import { usePreferencesStore } from './stores/preferences-store'

// index.html's inline script has already applied the theme; this keeps it
// following the OS while the choice is "system".
watchSystemTheme()

// Applied before the first render so the window does not paint at 100% and then jump.
const applyScale = (scale: number) => window.loftgcs?.app.setZoomFactor(scale)
applyScale(usePreferencesStore.getState().uiScale)
usePreferencesStore.subscribe((s, prev) => {
  if (s.uiScale !== prev.uiScale) applyScale(s.uiScale)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
