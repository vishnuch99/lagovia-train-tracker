import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy any /departures request to the backend so the browser never
    // sees a cross-origin call — equivalent to setting a base URL per
    // build variant in Android's build.gradle.
    proxy: {
      '/departures': 'http://localhost:3001',
    },
  },
});
