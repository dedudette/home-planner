import { SCHEMA_VERSION, validateAppData } from '../../src/storage/schema';
import type { AppData } from '../../src/domain/types';
import { withUser, type Db } from '../db/pool';
import { fail, json, readJson } from '../http';

/**
 * Optional cloud backup of the person's plan data: a snapshot they choose to send, restored only when they choose to bring it back.
 *
 *  - Off by default. Nothing is sent unless the person presses "Back up now".
 *  - The server rebuilds the snapshot through the app's own validator (so only well-formed data is stored) and removes the private parts
 *    unless the person ticked them: the private journal (and the text of check-in notes) unless `journal` is in `includes`, and the data
 *    read from the phone's health service unless `health` is. The server does this itself, not only the app, so a default of "private"
 *    holds even if a screen forgets to filter.
 *  - A revision number guards against overwriting: a backup is accepted only if the sender knew the current revision. Otherwise the server
 *    answers 409 with what is there and the app shows both, never a silent overwrite.
 *  - Stored as plain JSON in the database, protected by the account and the database's own controls. It is NOT end-to-end encrypted, and the
 *    app does not claim it is.
 */
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
export type Include = 'journal' | 'health';
const INCLUDES: readonly Include[] = ['journal', 'health'];

export const stripPrivate = (data: AppData, includes: readonly Include[]): AppData => {
  const out: AppData = JSON.parse(JSON.stringify(data));
  if (!includes.includes('journal')) {
    out.wellbeing = { ...out.wellbeing, journal: [], checkins: out.wellbeing.checkins.map((c) => ({ ...c, note: '' })) };
  }
  if (!includes.includes('health')) out.health = { ...out.health, daily: {}, lastSync: null };
  return out;
};

export interface BackupMeta { revision: number; includes: Include[]; sizeBytes: number; schemaVersion: number | null; updatedAt: string }

const meta = (r: { revision: number; includes: unknown; size_bytes: number; schema_version: number | null; updated_at: Date }): BackupMeta =>
  ({ revision: r.revision, includes: (Array.isArray(r.includes) ? r.includes : []).filter((x): x is Include => INCLUDES.includes(x as Include)), sizeBytes: r.size_bytes, schemaVersion: r.schema_version, updatedAt: r.updated_at.toISOString() });

export const backupRoutes = (db: Db, o: { fullAccess: (userId: string) => Promise<boolean>; now: () => Date }) => ({
  async get(userId: string, metaOnly: boolean): Promise<Response> {
    const r = await withUser(db, userId, (c) => c.query('select revision, includes, size_bytes, schema_version, updated_at, snapshot from user_backups where user_id = $1', [userId]));
    if (!r.rowCount) return json(200, { ok: true, backup: null });
    return json(200, { ok: true, backup: meta(r.rows[0]), ...(metaOnly ? {} : { data: r.rows[0].snapshot }) });
  },
  async put(userId: string, req: Request): Promise<Response> {
    if (!(await o.fullAccess(userId))) return fail(402, 'subscription-required', 'Cloud backup is part of an active trial or subscription.');
    const body = await readJson(req, MAX_BACKUP_BYTES + 4096);
    if (!body.ok) return body.response;
    const b = body.value as { baseRevision?: unknown; includes?: unknown; data?: unknown };
    const base = b.baseRevision === null || b.baseRevision === undefined ? null : typeof b.baseRevision === 'number' && Number.isInteger(b.baseRevision) && b.baseRevision > 0 ? b.baseRevision : NaN;
    if (Number.isNaN(base)) return fail(400, 'invalid', 'That request could not be read.');
    const includes = (Array.isArray(b.includes) ? b.includes : []).filter((x): x is Include => INCLUDES.includes(x as Include));
    const v = validateAppData(b.data);
    if (!v || v.fromFuture) return fail(422, 'invalid-data', 'That data could not be read as CleanFlow data, so it was not saved.');
    const clean = stripPrivate(v.data, includes);
    const text = JSON.stringify(clean);
    if (text.length > MAX_BACKUP_BYTES) return fail(413, 'too-large', 'That backup is larger than the 5 MB limit.');
    return withUser(db, userId, async (c) => {
      const cur = await c.query('select revision from user_backups where user_id = $1 for update', [userId]);
      const have: number | null = cur.rowCount ? cur.rows[0].revision : null;
      if (have !== base) {
        const m = await c.query('select revision, includes, size_bytes, schema_version, updated_at from user_backups where user_id = $1', [userId]);
        return fail(409, 'conflict', 'The cloud copy changed since this device last saw it. Nothing was overwritten.', { current: m.rowCount ? meta(m.rows[0]) : null });
      }
      const rev = (have ?? 0) + 1;
      await c.query(
        `insert into user_backups (user_id, revision, snapshot, includes, schema_version, size_bytes, updated_at) values ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)
         on conflict (user_id) do update set revision = excluded.revision, snapshot = excluded.snapshot, includes = excluded.includes, schema_version = excluded.schema_version, size_bytes = excluded.size_bytes, updated_at = excluded.updated_at`,
        [userId, rev, text, JSON.stringify(includes), SCHEMA_VERSION, text.length, o.now()]);
      const m = await c.query('select revision, includes, size_bytes, schema_version, updated_at from user_backups where user_id = $1', [userId]);
      return json(200, { ok: true, backup: meta(m.rows[0]) });
    });
  },
  async remove(userId: string): Promise<Response> {
    await withUser(db, userId, (c) => c.query('delete from user_backups where user_id = $1', [userId]));
    return json(200, { ok: true, backup: null });
  },
});
