import { defineConfig } from 'vite-plus';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

// base './' so the built files work from any folder,
// e.g. Home Assistant's /local/floorplan/.
export default defineConfig({
  base: './',
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Floor Plan',
        short_name: 'FloorPlan',
        description: 'Draw a to-scale floor plan from laser-meter readings.',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#2563eb',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // The API and the sign-in redirect must always reach the server.
        navigateFallbackDenylist: [/\/api\//],
      },
    }),
  ],
  server: {
    // `dotnet run` in server/Floorplan.Api listens here in Development.
    proxy: { '/api': 'http://localhost:5080' },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
  lint: {
    ignorePatterns: ['dist/**', 'dev-dist/**'],
  },
});
