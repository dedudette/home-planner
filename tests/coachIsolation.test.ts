import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const COACH_ENV = /COACH_(PROVIDER|MODEL|API_BASE_URL|DISABLED|TIMEOUT_MS|MAX_OUTPUT_TOKENS|COOLDOWN_SECONDS|DAILY_|ALLOWED_ORIGINS|TRUST_PROXY)/;
const SERVER_ONLY = [/ANTHROPIC/i, /x-api-key/i, /@anthropic-ai/, /api\.anthropic\.com/i, /process\.env/, COACH_ENV];

describe('the provider key can only ever live on the server', () => {
  const clientFiles = walk(join(ROOT, 'src')).filter((f) => /\.(ts|tsx|css|html)$/.test(f));

  it('no client source mentions the key, the provider SDK, the provider address, the server settings or process.env', () => {
    expect(clientFiles.length).toBeGreaterThan(40);
    for (const f of clientFiles) {
      const text = readFileSync(f, 'utf8');
      // the one place the app names its own endpoint is a same-origin path, nothing more
      for (const re of SERVER_ONLY) expect(re.test(text), `${f.replace(ROOT, '')} matches ${re}`).toBe(false);
      expect(/from\s+['"][./]*server\//.test(text), `${f} imports server code`).toBe(false);
    }
  });

  it('client code talks only to its own origin: no absolute URL for the AI anywhere in src', () => {
    for (const f of clientFiles) expect(/https?:\/\/[^'"\s)]*(anthropic|openai|claude)/i.test(readFileSync(f, 'utf8')), f).toBe(false);
    expect(readFileSync(join(ROOT, 'src/features/patterns/coachController.ts'), 'utf8')).toMatch(/const ASK_URL = '\/api\/coach'/);
  });

  it('the shared domain code that the server also uses imports nothing from the server', () => {
    for (const f of walk(join(ROOT, 'src/domain/coach'))) expect(readFileSync(f, 'utf8')).not.toMatch(/server\//);
  });

  it('the build does not expose environment variables to the browser by name, and secrets are kept out of git', () => {
    const vite = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
    expect(vite).not.toMatch(/envPrefix|define\s*:/);
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n');
    expect(ignore).toContain('.env');
    expect(ignore).toContain('.env.*');
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(tracked.filter((f) => /(^|\/)\.env($|\.)/.test(f) && !/\.example$/.test(f))).toEqual([]);
  });

  it('no committed file contains something that looks like a provider key', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => f && !/package-lock\.json$|\.(png|ico|woff2?)$/.test(f));
    const hits = tracked.filter((f) => existsSync(join(ROOT, f)) && /sk-ant-[A-Za-z0-9_-]{16,}/.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(hits).toEqual([]);
  });

  it.skipIf(!existsSync(join(ROOT, 'dist/assets')))('a built bundle (when present) contains none of it', () => {
    for (const f of walk(join(ROOT, 'dist'))) {
      if (!/\.(js|css|html|map)$/.test(f)) continue;
      const text = readFileSync(f, 'utf8');
      for (const re of [/ANTHROPIC/i, /x-api-key/i, /api\.anthropic\.com/i, /sk-ant-/, COACH_ENV, /@anthropic-ai/]) expect(re.test(text), `${f.replace(ROOT, '')} matches ${re}`).toBe(false);
    }
  });
});

describe('an AI suggestion cannot change the plan: the code that shows it cannot reach it', () => {
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

  it('the controller and the panel import nothing that holds the person\'s data or can change it', () => {
    for (const f of ['src/features/patterns/coachController.ts', 'src/features/patterns/CoachPanel.tsx']) {
      const text = read(f);
      expect(text, f).not.toMatch(/from\s+['"][./]*state\//);
      expect(text, f).not.toMatch(/reducer|dispatch|useApp|localStorage|sessionStorage|indexedDB/);
    }
  });

  it('the page reads the data and nothing more: it never receives dispatch', () => {
    const text = read('src/features/patterns/Patterns.tsx');
    expect(text).toMatch(/const \{ data, today \} = useApp\(\)/);
    expect(text).not.toMatch(/dispatch|openSheet|reducer/);
  });

  it('the AI answer type has no field that could carry an action on the plan', () => {
    const text = read('src/domain/coach/output.ts');
    const iface = /export interface CoachSuggestion \{[\s\S]*?\n\}/.exec(text)![0].replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(iface).not.toMatch(/\b(dispatch|action|patch|apply|prefs|preferences|plan|goals?|schedule|budget)\b/i);
  });
});
