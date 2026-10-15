import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The phone-app shell. It wraps the same built web app (`dist/`), and is what lets reminders arrive when the app is closed and lets
 * Apple Health or Health Connect be read. Nothing native has been built or run from this repository yet: see docs/native-integrations.md.
 *
 * `appId` is a placeholder. Choose your own reverse-domain id before creating the native projects (`npx cap add ios`, `npx cap add android`):
 * it identifies the app to the app stores and cannot be changed freely afterwards.
 */
const config: CapacitorConfig = {
  appId: 'example.cleanflow.planner',
  appName: 'CleanFlow',
  webDir: 'dist',
};

export default config;
