import { createAssistHandler, type AssistDeps } from './assist/handler';
import { createCoachHandler, type CoachDeps } from './coach/handler';

/**
 * Everything the server answers under /api: the AI coach (counts the app computed, explained) and the assistant (candidates the app
 * filtered, chosen and explained). They share one set of environment settings and one provider adapter, and nothing else.
 */
export interface ApiHandler {
  (req: Request): Promise<Response | null>;
  describe(): string;
}

export const createApiHandler = (deps: CoachDeps & AssistDeps = {}): ApiHandler => {
  const coach = createCoachHandler(deps);
  const assist = createAssistHandler(deps);
  const h = (async (req: Request) => (await coach(req)) ?? (await assist(req))) as ApiHandler;
  h.describe = () => coach.describe();
  return h;
};

/** Paths this server owns, so a host knows which requests to hand over. */
export const isApiPath = (url: string): boolean => url.startsWith('/api/coach') || url.startsWith('/api/assist');
