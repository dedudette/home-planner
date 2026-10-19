import { ChangePassword, SignOutRow } from './AccountPanel';
import { useAccount } from './AccountProvider';

/** Who is signed in, with the ways out that must exist while the planner is closed: change password and sign out. (Delete and export are on the Trial & plans screen itself.) */
export const GateAccountCard = () => {
  const { user, signOut } = useAccount();
  if (!user) return null;
  return (
    <section className="card stack" aria-labelledby="gate-acct-h">
      <h2 id="gate-acct-h" className="h3">Your account</h2>
      <p className="small"><span className="muted">Signed in as</span> <b>{user.email}</b></p>
      <ChangePassword />
      <SignOutRow onSignOut={signOut} />
    </section>
  );
};

