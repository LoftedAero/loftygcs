import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// Order matters (DESIGN.md §1): the design system first, the app sheet
// second, so app rules win without !important.
import './styles/lofted-aero.css'
import './styles/app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
