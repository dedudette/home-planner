import type { Plugin } from 'vite';
import { createApp } from './createApp';
import { handleNodeRequest } from './nodeAdapter';

/**
 * Mounts the AI coach endpoint on the Vite dev server and on `vite preview`, so the feature can be developed and tried locally with
 * the same code that runs in production. The provider key comes from the server process environment (never from a file this repo
 * reads, and never from a VITE_ variable, which would be shipped to the browser).
 */
export const coachPlugin = (): Plugin => {
  const app = createApp();
  const handler = app.handler;
  const trustProxy = process.env.TRUST_PROXY === '1';
  const mount = (server: { middlewares: { use: (fn: (req: never, res: never, next: () => void) => void) => void }; config: { logger: { info: (m: string) => void } } }) => {
    server.config.logger.info(`  [ai] ${handler.describe()}`);
    server.config.logger.info(app.runtime ? '  [accounts] on' : app.problems.length ? `  [accounts] NOT STARTED: ${app.problems.join(' ')}` : '  [accounts] off (local mode)');
    if (app.runtime) setInterval(() => { void app.runtime!.tick(); }, 60_000).unref();
    server.middlewares.use(((req: Parameters<typeof handleNodeRequest>[1], res: Parameters<typeof handleNodeRequest>[2], next: () => void) => {
      handleNodeRequest(handler, req, res, { trustProxy }).then((done) => { if (!done) next(); }, () => { res.statusCode = 500; res.end(); });
    }) as never);
  };
  return { name: 'cleanflow-coach', configureServer: (s) => mount(s as never), configurePreviewServer: (s) => mount(s as never) };
};
