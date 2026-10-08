import { describe, expect, it } from 'vitest';
import readme from '../README.md?raw';
import { TEMPLATES } from '../src/domain/catalog';
import { DEMO_PROFILES } from '../src/domain/demo';
import { LIFE_TEMPLATES } from '../src/domain/lifeCatalog';
import { FOCUS_OPTIONS } from '../src/domain/options';
import { SCHEMA_VERSION } from '../src/storage/schema';
import { HARD_CHARS, SOFT_CHARS } from '../src/domain/retention';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

describe('the README states only what the source says', () => {
  it('home task template count', () => {
    expect(Number(/(\d+) home task templates/.exec(readme)![1])).toBe(TEMPLATES.length);
  });
  it('life template count', () => {
    expect(Number(/lifeCatalog\.ts\s+(\d+) templates/.exec(readme)![1])).toBe(LIFE_TEMPLATES.length);
  });
  it('example profile count', () => {
    const w = /load (\w+) example profiles/.exec(readme)![1];
    expect(WORDS.indexOf(w)).toBe(DEMO_PROFILES.length);
  });
  it('life areas', () => {
    const w = /across (\w+) areas/.exec(readme)![1];
    expect(WORDS.indexOf(w)).toBe(new Set(LIFE_TEMPLATES.map((t) => t.domain)).size);
  });
  it('schema version and storage thresholds', () => {
    expect(readme).toContain(`SCHEMA_VERSION = ${SCHEMA_VERSION}`);
    expect(readme).toContain(`At ${(SOFT_CHARS / 1e6).toFixed(1)} M`);
    expect(readme).toContain(`at ${(HARD_CHARS / 1e6).toFixed(1)} M`);
  });
  it('goals', () => {
    expect(FOCUS_OPTIONS.filter((f) => f.value !== 'home')).toHaveLength(11);
  });
  it('names the four browser suites', () => {
    for (const f of ['flow.mjs', 'responsive', 'integrity', 'sync']) expect(readme).toContain(f.replace('.mjs', ''));
    expect(readme).toMatch(/four browser suites/);
  });
});
