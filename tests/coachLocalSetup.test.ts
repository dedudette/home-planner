import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCoachPayload, validatePayload } from '../src/domain/coach/metrics';
import { computePatterns } from '../src/domain/patterns';
import { interpret, exportJSON, importJSON } from '../src/storage/repository';
import { buildSampleData, SAMPLE_DAYS } from '../scripts/sampleData';

const SCRIPT = join(__dirname, '..', 'scripts', 'with-keychain-key.sh');
const KEY = 'sk-test-FROM-A-FAKE-KEYCHAIN-0451';

/** A stand-in for macOS's `security` command, so the launcher can be tested here without a Keychain. */
const fakeSecurity = (behaviour: 'has-key' | 'empty' | 'missing-item') => {
  const dir = mkdtempSync(join(tmpdir(), 'cleanflow-fake-security-'));
  const body = behaviour === 'has-key' ? `printf '%s\\n' '${KEY}'` : behaviour === 'empty' ? 'printf ""' : 'exit 44';
  writeFileSync(join(dir, 'security'), `#!/bin/sh\n[ "$1" = "find-generic-password" ] || exit 1\n${body}\n`);
  chmodSync(join(dir, 'security'), 0o755);
  return dir;
};
const run = (args: string[], binDir: string | null, env: Record<string, string> = {}) =>
  spawnSync('sh', [SCRIPT, ...args], { encoding: 'utf8', env: { PATH: `${binDir ? binDir + ':' : ''}/usr/bin:/bin`, USER: 'tester', ...env } });

describe('the Keychain launcher keeps the key out of history, files and output', () => {
  it('hands the key to the command it starts, and prints nothing itself', () => {
    const r = run(['sh', '-c', `test "$ANTHROPIC_API_KEY" = "${KEY}" && echo KEY-REACHED-THE-COMMAND`], fakeSecurity('has-key'));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('KEY-REACHED-THE-COMMAND');
    expect(r.stdout + r.stderr).not.toContain(KEY);
  });

  it('exports it to that command only: the key is not in the launcher\'s own environment afterwards', () => {
    const r = run(['sh', '-c', 'env | grep -c "^ANTHROPIC_API_KEY=" || true'], fakeSecurity('has-key'));
    expect(r.stdout.trim()).toBe('1');                                    // inside the child, once
  });

  it('a missing or empty Keychain item stops with instructions that never contain a key, and starts nothing', () => {
    for (const mode of ['missing-item', 'empty'] as const) {
      const r = run(['sh', '-c', 'echo SHOULD-NOT-RUN'], fakeSecurity(mode));
      expect(r.status).toBe(1);
      expect(r.stdout).not.toContain('SHOULD-NOT-RUN');
      expect(r.stderr).toMatch(/No Keychain item named 'cleanflow-anthropic-api-key'/);
      expect(r.stderr).toMatch(/security add-generic-password .* -w/);
      expect(r.stderr).not.toMatch(/sk-/);
    }
  });

  it('says so, and starts nothing, on a system with no Keychain command', () => {
    const r = run(['sh', '-c', 'echo SHOULD-NOT-RUN'], null);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain('SHOULD-NOT-RUN');
    expect(r.stderr).toMatch(/macOS Keychain/);
  });

  it('needs a command to run, and the item name can be changed without editing the script', () => {
    expect(run([], fakeSecurity('has-key')).status).toBe(2);
    const dir = mkdtempSync(join(tmpdir(), 'cleanflow-fake-security-'));
    writeFileSync(join(dir, 'security'), '#!/bin/sh\n[ "$5" = "my-other-item" ] && printf "%s\\n" "' + KEY + '" || exit 44\n');
    chmodSync(join(dir, 'security'), 0o755);
    const r = run(['sh', '-c', 'echo ok'], dir, { COACH_KEYCHAIN_SERVICE: 'my-other-item' });
    expect(r.stdout.trim()).toBe('ok');
  });

  it('the script itself contains no key and never echoes the variable', async () => {
    const text = (await import('node:fs')).readFileSync(SCRIPT, 'utf8');
    expect(text).not.toMatch(/sk-ant-/);
    expect(text).not.toMatch(/echo[^\n]*\$\{?(KEY|ANTHROPIC_API_KEY)/);
    expect(text).not.toMatch(/set -x/);
  });
});

describe('the sample data for trying the page and the coach', () => {
  const TODAY = '2026-10-14';
  const data = buildSampleData(TODAY);

  it('is valid data: the app loads it without repairs or drops, and it survives an export and a restore', () => {
    const loaded = interpret(JSON.stringify(data));
    expect(loaded.status === 'ok' || loaded.status === 'empty' ? loaded.repairs : ['unreadable']).toEqual([]);
    const imported = importJSON(exportJSON(data));
    expect(imported.ok).toBe(true);
    expect(imported.repairs).toEqual([]);
    expect(imported.data!.exposures.length).toBe(data.exposures.length);
  });

  it('says it is made up, and holds no real-looking personal text', () => {
    expect(data.user.name).toBe('Sample data');
    expect(JSON.stringify(data)).not.toMatch(/@|https?:/);
  });

  it('gives enough recorded days to use the coach in every window, with a realistic mix', () => {
    for (const w of [7, 14, 28] as const) {
      const p = computePatterns(data, TODAY, w);
      expect(p.evidence.sufficient, `${w} days`).toBe(true);
      expect(p.days.opened).toBeGreaterThanOrEqual(5);
      expect(buildCoachPayload(p)).not.toBeNull();
    }
    const p = computePatterns(data, TODAY, 14);
    expect(p.days.notOpened).toBeGreaterThan(0);                           // the gaps are real "not opened" days
    expect(p.seen.completed).toBeGreaterThan(0);
    expect(p.seen.skipped).toBeGreaterThan(0);
    expect(p.seen.noAction).toBeGreaterThan(0);
    expect(p.leftOut.notEnoughTime + p.leftOut.lowEnergyDay + p.leftOut.notACleaningDay).toBeGreaterThan(0);
    const check = validatePayload(buildCoachPayload(p));
    expect(check.ok).toBe(true);
    expect(SAMPLE_DAYS).toBe(21);
  });

  it('gives the same counts every time for the same date (only generated ids and timestamps differ), so a run is repeatable', () => {
    const again = buildSampleData(TODAY);
    for (const w of [7, 14, 28] as const) expect(JSON.stringify(computePatterns(again, TODAY, w))).toBe(JSON.stringify(computePatterns(data, TODAY, w)));
    expect(JSON.stringify(again.exposures)).toBe(JSON.stringify(data.exposures));
    expect(again.sessions.flatMap((s) => s.entries).map((e) => e.id)).toEqual(data.sessions.flatMap((s) => s.entries).map((e) => e.id));
  });
});
