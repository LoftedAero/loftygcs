import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// Order matters (DESIGN.md §1): the design system first, the app sheet
// second, so app rules win without !important.
import './styles/lofted-aero.css'
import './styles/app.css'
import { watchSystemTheme } from './stores/theme-store'

// Before the first render: the inline script in index.html has already
// stamped the document, and this keeps it following the OS while the choice
// is "system".
watchSystemTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
