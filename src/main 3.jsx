import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { applyStoredThemeEarly } from './hooks/useTheme'

// Before the first paint, or the page flashes light and then corrects itself.
applyStoredThemeEarly()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
