import type { Plugin } from 'vite';
import { createApiHandler } from './api';
import { handleNodeRequest } from './nodeAdapter';

/**
 * Mounts the AI coach endpoint on the Vite dev server and on `vite preview`, so the feature can be developed and tried locally with
 * the same code that runs in production. The provider key comes from the server process environment (never from a file this repo
 * reads, and never from a VITE_ variable, which would be shipped to the browser).
 */
export const coachPlugin = (): Plugin => {
  const handler = createApiHandler();
  const mount = (server: { middlewares: { use: (fn: (req: never, res: never, next: () => void) => void) => void }; config: { logger: { info: (m: string) => void } } }) => {
    server.config.logger.info(`  [ai] ${handler.describe()}`);
    server.middlewares.use(((req: Parameters<typeof handleNodeRequest>[1], res: Parameters<typeof handleNodeRequest>[2], next: () => void) => {
      handleNodeRequest(handler, req, res).then((done) => { if (!done) next(); }, () => { res.statusCode = 500; res.end(); });
    }) as never);
  };
  return { name: 'cleanflow-coach', configureServer: (s) => mount(s as never), configurePreviewServer: (s) => mount(s as never) };
};
