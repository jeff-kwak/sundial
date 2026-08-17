import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Served as a GitHub Pages *project* site: https://jeff-kwak.github.io/sundial/
// The account's user site is already the owner's bio, so root is unavailable.
//
// BASE must agree with the manifest scope/start_url and the service-worker
// location. A service worker's scope cannot exceed its own directory, so the
// worker must be emitted inside BASE. Disagreement here does not fail loudly —
// it installs a PWA that never works offline, which is the whole point of the app.
const BASE = '/sundial/'

export default defineConfig({
  base: BASE,
  build: {
    target: 'es2022',
    // One screen, one entry. Splitting would only add round trips.
    modulePreload: { polyfill: false },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: BASE,
        name: 'Sundial',
        short_name: 'Sundial',
        description: 'When is there enough light outside to see?',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#05070d',
        theme_color: '#05070d',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Every asset is content-hashed and there is no runtime data, so the
        // whole app is precached and nothing is ever fetched at runtime.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: `${BASE}index.html`,
      },
    }),
  ],
})
