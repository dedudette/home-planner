import { INCLUDES, MAX_BACKUP_BYTES, stripPrivate, type Include } from '../../src/storage/backupPlan';
import { SCHEMA_VERSION, validateAppData } from '../../src/storage/schema';
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
 *  - Revision numbers are never reused. Deleting a backup wipes its content and keeps only the counter, so a device that remembers an old
 *    revision cannot overwrite a newer copy that was created after a deletion, and two first uploads at once cannot both succeed.
 *  - Stored as plain JSON in the database, protected by the account and the database's own controls. It is NOT end-to-end encrypted, and the
 *    app does not claim it is.
 */
export { MAX_BACKUP_BYTES, stripPrivate };
export type { Include };

export interface BackupMeta { revision: number; includes: Include[]; sizeBytes: number; schemaVersion: number | null; updatedAt: string }

const meta = (r: { revision: number; includes: unknown; size_bytes: number; schema_version: number | null; updated_at: Date }): BackupMeta =>
  ({ revision: r.revision, includes: (Array.isArray(r.includes) ? r.includes : []).filter((x): x is Include => INCLUDES.includes(x as Include)), sizeBytes: r.size_bytes, schemaVersion: r.schema_version, updatedAt: r.updated_at.toISOString() });

export const backupRoutes = (db: Db, o: { fullAccess: (userId: string) => Promise<boolean>; now: () => Date }) => ({
  async get(userId: string, metaOnly: boolean): Promise<Response> {
    const r = await withUser(db, userId, (c) => c.query('select revision, includes, size_bytes, schema_version, updated_at, snapshot from user_backups where user_id = $1 and deleted_at is null', [userId]));
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
      // One writer per person at a time. A row lock alone cannot do this when there is no row yet (two first uploads would both see "nothing
      // there" and both be accepted), so the transaction takes a lock keyed on the person first.
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`user_backups:${userId}`]);
      const cur = await c.query('select revision, deleted_at from user_backups where user_id = $1', [userId]);
      const row = cur.rowCount ? (cur.rows[0] as { revision: number; deleted_at: Date | null }) : null;
      const have: number | null = row && !row.deleted_at ? row.revision : null;     // a deleted backup is "nothing there", but its counter lives on
      if (have !== base) {
        const m = await c.query('select revision, includes, size_bytes, schema_version, updated_at from user_backups where user_id = $1 and deleted_at is null', [userId]);
        return fail(409, 'conflict', 'The cloud copy changed since this device last saw it. Nothing was overwritten.', { current: m.rowCount ? meta(m.rows[0]) : null });
      }
      const rev = (row?.revision ?? 0) + 1;
      await c.query(
        `insert into user_backups (user_id, revision, snapshot, includes, schema_version, size_bytes, updated_at, deleted_at) values ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, null)
         on conflict (user_id) do update set revision = excluded.revision, snapshot = excluded.snapshot, includes = excluded.includes, schema_version = excluded.schema_version, size_bytes = excluded.size_bytes, updated_at = excluded.updated_at, deleted_at = null`,
        [userId, rev, text, JSON.stringify(includes), SCHEMA_VERSION, text.length, o.now()]);
      const m = await c.query('select revision, includes, size_bytes, schema_version, updated_at from user_backups where user_id = $1', [userId]);
      return json(200, { ok: true, backup: meta(m.rows[0]) });
    });
  },
  async remove(userId: string): Promise<Response> {
    // Wipe the content, keep the counter (see the note at the top): nothing of the person's data stays in the row.
    await withUser(db, userId, async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`user_backups:${userId}`]);
      await c.query(
        `update user_backups set snapshot = '{}'::jsonb, includes = '[]'::jsonb, schema_version = null, size_bytes = 0, updated_at = $2, deleted_at = $2 where user_id = $1 and deleted_at is null`,
        [userId, o.now()]);
    });
    return json(200, { ok: true, backup: null });
  },
});
