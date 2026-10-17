import { useAccount } from './AccountProvider';
import { CloudBackupCard } from './CloudBackupCard';
import { DeviceDataCard } from './DeviceDataCard';
import { AuthFrame, Notice } from './Screens';

/**
 * Your data and backup: what lives where, copying data from before accounts into the account, and the optional manual cloud backup.
 * Nothing on this screen starts a trial, changes a subscription or sends anything without a button press on a preview.
 */
export const DataBackup = () => {
  const { mode, user } = useAccount();
  const back = <><a href="#/account">Trial &amp; plans</a> · <a href="#/settings">Settings</a> · <a href="#/">Back to the app</a></>;
  if (mode !== 'accounts' || !user) {
    return (
      <AuthFrame title="Your data and backup" lead="This setup has no accounts, so everything stays on this device." footer={back}>
        <Notice>CleanFlow is running without accounts here. Your plan, history, journal and health readings are saved in this browser only, and nothing is uploaded. There is no cloud backup in this setup. To keep a copy, use Export backup in Settings.</Notice>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="Your data and backup" lead="What stays on this device, what you can copy to your account, and what you can back up to the cloud. You choose each one." footer={back} wide>
      <WhereDataLives />
      <DeviceDataCard />
      <CloudBackupCard />
    </AuthFrame>
  );
};

const WhereDataLives = () => (
  <section className="card stack" aria-labelledby="where-h">
    <h2 id="where-h" className="h3">Where your data is</h2>
    <dl className="data-dl small">
      <div><dt>On this device (always)</dt><dd>Everything: your plan and history, your journal and check-in notes, your health readings, timers and settings. CleanFlow works from this copy. It stays on this device unless you choose to back it up.</dd></div>
      <div><dt>In your cloud backup (only if you choose)</dt><dd>Only when you press Back up now, and only what the preview lists. Your plan and history are included. Your private journal (with the text of check-in notes) and your health readings are left out unless you tick each one, separately.</dd></div>
      <div><dt>Never backed up</dt><dd>A timer or workout that is running, and this device’s reminder schedule.</dd></div>
      <div><dt>Not end-to-end encrypted</dt><dd>A backup is stored as readable text on the server, protected by your account sign-in. Leave out anything you would not want the service to be able to read.</dd></div>
      <div><dt>A copy, not sync</dt><dd>Changes you make later are not sent until you back up again, and another device gets your backup only when you restore it there. Signing in on a new device starts empty.</dd></div>
      <div><dt>You stay in control</dt><dd>You can delete the cloud backup at any time, whatever your trial or subscription says. Deleting your account removes it too.</dd></div>
    </dl>
  </section>
);
