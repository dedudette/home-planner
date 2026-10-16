/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { coachPlugin } from './server/vitePlugin';

export default defineConfig({
  plugins: [react(), coachPlugin()],
  server: { host: true, port: 5173 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
