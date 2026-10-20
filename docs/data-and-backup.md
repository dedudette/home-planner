# Your data, copying it into an account, and the optional cloud backup (issue #6)

The screen is **Data & backup** (`#/account/data`, reachable from Settings → Account, from Trial & plans, and from the "your earlier data is
safe" screen after a first sign-in). It exists only when the server has accounts. Without accounts (local mode, or a build made for "no server
at all") the same address says that nothing leaves the device, offers no controls, and sends no request.

Nothing on the screen starts a trial, changes a subscription, or sends anything without a button press on a preview.

**It stays open when the planner is closed** (no trial yet, trial or subscription ended, a payment problem): copying earlier data in, restoring and deleting a cloud backup, and **Download my plan and history** (a file made on the device, no server, always available) all work without any entitlement. Only *Back up now* needs one, and the server decides that (402). Settings and the planner are behind the gate (`docs/billing.md`), so restore points are listed here but restored from Settings once the planner is open.

## Where data lives

| | On this device | In the cloud backup |
|---|---|---|
| Plan, history, tasks, meals, movement, water, learning, check-ins (mood, energy, date), settings | always | only if the person presses **Back up now** |
| Private journal and the **text** of check-in notes | always | **only if ticked** (its own choice, unticked every time the panel opens) |
| Health readings imported from Apple Health / Health Connect | always | **only if ticked** (its own choice) |
| A running timer or workout, this device's reminder schedule | always | never |
| **Unsent text** kept because the person left (the planner closed, the session ended, they signed out, or the account changed under an open form; see `docs/billing.md`, "Unsent text when the person leaves") | on this device only, under the account's own key `cleanflow:drafts@<id>`, until finished, discarded, 30 days, or the account is deleted | **never** (not in a backup upload, the downloaded plan file or the account export) |

A backup is a **copy, not sync**: later changes are not sent until the next backup, and another device gets it only when its owner restores it
there. It is stored as readable JSON text in the server's database, protected by the account sign-in. It is **not end-to-end encrypted**, and
the screen says so next to the two private choices. Deleting an account removes its backup (tested). Deleting the backup is always available,
whatever the trial or subscription says.

## Copying data from before accounts into an account

Data this browser saved before accounts sits under the original storage key. With accounts on, each account works in its own namespaced copy
(`cleanflow:v1@<account id>`), so the original is never read, written or erased by account code. Copying is a separate, explicit step:

1. **Preview.** The screen counts what the earlier data holds (logged actions and days, tasks, meals…, and, separately, the private journal and
   the health readings), and what the account already holds if it has a plan.
2. **The account has no plan yet:** the copy replaces nothing. **The account already has a plan:** nothing is merged and nothing is replaced
   unless the person chooses *Replace it with my earlier data*; *Keep this account's plan as it is* is the selected default and has no button.
3. **Order of the copy** (`src/account/link.ts`, `performLink`): write an *intent* record → keep a **restore point** of the earlier data and, when
   replacing, of the account's own plan (**if either cannot be kept, stop: nothing has changed**) → put the copy into the running app and write it
   to storage → **read storage back and compare**; if it is not what was written, the previous plan is put back → record which account got the copy
   and drop the intent.
4. The original is **never moved, changed or deleted** (checked byte for byte in the browser suite). The copy is also offered as a file download.
5. **Undo this copy** is offered on the success notice. Restore points are listed on the screen and restored from Settings → Automatic backups
   (labels in `src/storage/backupReasons.ts`).
6. **A second account on the same device** is told when the earlier data was already copied into another account here, and must tick a box
   saying it understands the same data, including any private journal, will also be in this account.
7. Nothing in the copy calls the server, so it cannot start or reset a trial, change a subscription, or depend on an entitlement (the browser
   suite compares the account view before and after, with an account that has neither a trial nor a subscription).

### Interrupted copies

The intent record (`cleanflow:link-intent@<account id>`) lets the next visit say what is true, **worked out from what is stored**, not from a flag:
*"did finish"* (the account holds that plan) or *"did not finish, nothing was changed"*. A copy the app has touched since is still recognised
(the plan carries its own id). A damaged or invented record is ignored. When an account is deleted, the device's records for it go too (the
backup memory always; the intent and the "went into that account" note when its plan is erased from the device).

## The optional cloud backup

Uses the existing endpoints (`GET/PUT/DELETE /api/account/backup`, `src/account/api.ts`); there is no second backup system.

- **Exact upload preview.** The screen builds the very payload it will send (`planUpload` in `src/storage/backupPlan.ts`, shared with the server)
  and lists it: the plan data in words, the journal and health lines (sent, or "not uploaded (N entries stay on this device)"), the size, and
  whether it replaces a cloud copy. With nothing ticked the **request itself contains none of the private text** (browser suite checks the
  request body), and the server strips again on its own, so a screen that forgets cannot leak.
- **Leaving something out removes it from the cloud.** If the current cloud copy includes the journal or health and the new upload leaves it
  out, the preview says so before upload.
- **Revisions.** The device remembers the revision it last saw (per account). An upload goes out with that revision as its base and the server
  accepts it only if it is still current. The screen compares first and, on any difference, shows a **conflict** instead of an upload button:
  *unseen* (a copy this device never saw, for example from another device), *changed* (newer than this device saw), or *deleted*.
- **Choices in a conflict,** side by side (cloud copy and this device, with counts): **Keep the cloud copy (upload nothing)**; **Restore the cloud
  copy to this device**; **Replace the cloud copy with this device** (needs a tick, keeps a copy of the cloud backup on this device first; for a
  deleted copy the choice is "Upload as a new cloud copy"). If the server refuses with a 409 anyway (a change between opening the panel and
  pressing Upload), the same choices appear and nothing was overwritten.
- **Restore.** Shows both sides and what happens to the private parts: a part that **was not in the backup is kept as it is on this device**
  (restoring never wipes a journal or health history that was never in the cloud); a part that was is replaced (and the device's copy goes into
  the restore point). A restore point of the current plan is kept first; if it cannot be kept, nothing is restored. A backup from a newer app
  version or unreadable data is refused with a reason. After writing, storage is read back and the previous plan is put back if it differs.
- **Empty plans cannot be uploaded** (it would replace the cloud copy with nothing). Over 5 MB is refused with a way out (leave out the journal
  or health).
- **Delete my cloud backup** removes it from the account; this device forgets the revision; the plan on the device is untouched.
- **After the trial or subscription ends:** the screen does not offer *Back up now* and says why; restore, delete and the downloads still work.
  The server is the authority: it answers 402 to an upload without access (checked by a direct request in the browser suite), and a backup
  never starts, extends or resets anything.

### What the person is told when something fails

Every message says what happened to the data on this device (nothing: the app only copies to and from the cloud, after a restore point) and what
is true of the cloud copy (`describeBackup` in `src/account/errors.ts`, unit tested). An upload that gets **no answer** never claims either
outcome ("we cannot tell whether the cloud copy was updated"); the device keeps a note until the person has seen it, the next visit shows the real
revision, and the next upload is then a conflict to resolve, not an overwrite. The server's own wording is never shown.

## Backend defects found and fixed for this issue (both with tests that failed first)

1. **Revision numbers were reused after a deletion.** Deleting removed the row, so the next backup started again at revision 1 and a device that
   still remembered the old revision 1 could silently overwrite a newer copy. Deleting now wipes the content (snapshot, choices, size; checked
   in the database) and keeps only the counter (`server/db/migrations/0003_backup_revision.sql`).
2. **Two first uploads at once were both accepted** (a row lock cannot lock a row that does not exist yet), the second silently replacing the
   first. Each upload now takes a transaction lock keyed on the account.

## Tests

| What | Where |
|---|---|
| What a backup contains, the preview, the restore merge | `tests/backupPlan.test.ts` (unit) |
| Reading earlier data, the situations, the copy and its failures, interrupted copies, forgetting a deleted account | `tests/accountLink.test.ts` (unit, fake storage that can refuse writes) |
| Device memory, upload verdicts, conflict answers | `tests/accountCloudBackup.test.ts` (unit) |
| Words for failures | `tests/accountErrors.test.ts` (unit) |
| Exclusions for every combination of choices, spoofed choices, 30 notes, revisions, concurrency, deletion wipes content, isolation, expiry | `tests/db/backup.test.ts` (real PostgreSQL) |
| The screen's contract with the real server: two devices, deleted-then-recreated, entitlement untouched, expiry, two accounts, account deletion | `tests/db/backupContract.test.ts` (real PostgreSQL) |
| The browser: copying, replacing, undo, failures, interrupted copies, backing up with each choice, restoring, two devices, races, network failures, two accounts, local mode, expiry, layout and keyboard | `npm run e2e:backup` (real Chromium, real API and PostgreSQL) |

**Simulated, not real:** failures. Network failures are aborted or rewritten browser requests; storage failures make the browser's localStorage
refuse writes as a full store does; "a crash in the middle of a copy" is the exact state a crash would leave (a browser test cannot stop
JavaScript between two synchronous statements). No payment provider is involved anywhere in this feature.
