import { writeFileSync } from 'node:fs';
import { todayISO } from '../src/domain/dates';
import { exportJSON } from '../src/storage/repository';
import { buildSampleData, SAMPLE_DAYS } from './sampleData';

/**  npm run sample-data  →  ./cleanflow-sample-data.json (git-ignored). Import it in the app: Settings → Restore from a file. */
const out = process.argv[2] ?? 'cleanflow-sample-data.json';
const ending = process.argv[3] ?? todayISO();                 // a second argument (YYYY-MM-DD) is only for tests
if (!/^\d{4}-\d{2}-\d{2}$/.test(ending)) throw new Error('The date must look like 2026-10-14.');
const data = buildSampleData(ending);
writeFileSync(out, exportJSON(data));
console.log(`Wrote ${out}: ${SAMPLE_DAYS} days of made-up history ending ${ending}. It contains no real data.`);
console.log('In the app: Settings → Restore from a file → choose it → Replace my data (your current data is backed up first).');
