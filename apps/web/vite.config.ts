import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      manifest: {
        name: 'れんらくん',
        short_name: 'れんらくん',
        description: '家庭の消耗品をタップで共有する連絡アプリ',
        theme_color: '#f57f3a',
        background_color: '#fef6ea',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any'
          }
        ]
      },
      devOptions: {
        enabled: true
      }
    })
  ],
  server: {
    host: true,
    port: 5173
  }
})
