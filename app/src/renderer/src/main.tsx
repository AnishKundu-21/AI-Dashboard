import React from 'react'
import ReactDOM from 'react-dom/client'
// Self-hosted variable Inter — the renderer CSP forbids external font CDNs.
import '@fontsource-variable/inter'
import App from './App'
import './styles.css'

// Applied before first paint so the shell never flashes the wrong theme.
const stored = window.localStorage.getItem('aiud.theme')
document.documentElement.dataset.theme = stored === 'light' ? 'light' : 'dark'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
