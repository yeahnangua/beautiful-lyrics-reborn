import { defineConfig } from '@playwright/test';

// Validate the production module, including its isolated CSS and local image assets.
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', timeout: 45000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4179', viewport: { width: 1440, height: 900 },
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  webServer: { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4179 --strictPort', url: 'http://127.0.0.1:4179', reuseExistingServer: false },
});
