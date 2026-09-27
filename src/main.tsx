import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// Order matters (DESIGN.md §1): the design system first, the app sheet
// second, so app rules win without !important.
import './styles/lofted-aero.css'
import './styles/app.css'
import { watchSystemTheme } from './stores/theme-store'
import { usePreferencesStore } from './stores/preferences-store'

// Before the first render: the inline script in index.html has already
// stamped the document, and this keeps it following the OS while the choice
// is "system".
watchSystemTheme()

// The interface scale, before the first render so the window does not paint
// at 100% and then jump, and again whenever it changes -- the preferences
// dialog, and its Reset.
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
