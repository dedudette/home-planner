/** Why a restore point was kept on the device, in words. Shared by Settings and the data & backup screen. */
export const BACKUP_REASON: Record<string, string> = {
  demo: 'before loading a demo',
  import: 'before restoring a file',
  restore: 'before restoring a backup',
  unreadable: 'unreadable data',
  repaired: 'before repairing',
  migrated: 'before upgrading',
  newer: 'newer version',
  'before-restore': 'before a restore',
  'before-link': 'before your earlier data was copied in',
  'device-copy': 'copy of the earlier data from this device',
  'before-cloud-restore': 'before restoring from the cloud',
  'cloud-copy': 'copy of the cloud backup, kept before it was replaced',
};
