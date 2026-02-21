import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles.css'

let hasPendingUpdate = false

const updateSW = registerSW({
  immediate: true,
  onRegistered(registration) {
    console.info('[pwa] service worker registered', {
      scope: registration?.scope ?? 'unknown'
    })
  },
  onNeedRefresh() {
    hasPendingUpdate = true
    console.info('[pwa] update available; apply on next background transition')
  },
  onRegisterError(error) {
    console.error('[pwa] service worker registration failed', error)
  }
})

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!hasPendingUpdate || document.visibilityState !== 'hidden') return
    hasPendingUpdate = false
    void updateSW(true)
    console.info('[pwa] update applied while app moved to background')
  })
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
