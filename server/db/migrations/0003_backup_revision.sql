-- A cloud backup's revision number must never be reused. Deleting a backup used to delete its row, so the next backup started again at
-- revision 1 and a device that still remembered the old revision 1 could silently overwrite the new copy. Deleting now empties the row
-- (the snapshot, the choices and the size are wiped, nothing of the person's data stays) and keeps only the counter, marked deleted.
alter table user_backups add column deleted_at timestamptz;
