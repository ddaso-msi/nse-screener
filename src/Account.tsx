import { useEffect, useState } from 'react';
import { Icon } from './ui';

export interface Me { name: string; admin: boolean; created: string | null }

async function post(action: string, body: object = {}) {
  const res = await fetch(`/api/auth/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || 'Something went wrong. Try again.');
  return out;
}

const forget = () => {
  for (const k of ['watchlist', 'paper', 'drawings', 'journal']) localStorage.removeItem(`nse-screener.${k}`);
};

/** Your account: password, devices, your data, and leaving. Hosted site only. */
export function AccountPanel({ me, onClose }: { me: Me; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string; where: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [leavePassword, setLeavePassword] = useState('');
  const [leaveSure, setLeaveSure] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (where: string, work: () => Promise<string | void>) => {
    setBusy(where);
    setMsg(null);
    try {
      const text = await work();
      if (text) setMsg({ kind: 'ok', text, where });
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message, where });
    } finally {
      setBusy('');
    }
  };

  const changePassword = (e: React.FormEvent) => {
    e.preventDefault();
    run('password', async () => {
      if (next !== again) throw new Error('The two new passwords do not match.');
      await post('password', { current, password: next });
      setCurrent(''); setNext(''); setAgain('');
      return 'Password changed. Any other device you were signed in on has been signed out.';
    });
  };

  const download = () =>
    run('data', async () => {
      const [watchlist, paper, drawings, journal] = await Promise.all(
        ['watchlist', 'paper', 'drawings', 'journal'].map((k) => fetch(`/api/user/${k}`).then((r) => (r.ok ? r.json() : null))),
      );
      const blob = new Blob([JSON.stringify({ account: me.name, exported: new Date().toISOString(), watchlist, paper, drawings, journal }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `sensa-${me.name}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

  const msgFor = (where: string) => msg?.where === where && <p className={`acct-msg ${msg.kind}`} role="status">{msg.text}</p>;
  const since = me.created ? new Date(me.created).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : null;

  return (
    <div className="help-scrim" onClick={onClose}>
      <div className="help account" role="dialog" aria-modal="true" aria-label="Your account" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          <div>
            <h2>{me.name}</h2>
            <p className="muted">{me.admin ? 'Site owner' : 'Member'}{since && ` · since ${since}`}</p>
          </div>
          <button className="icon" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>

        <section>
          <h3>Change password</h3>
          <form onSubmit={changePassword} className="acct-form">
            <input type="text" name="username" autoComplete="username" value={me.name} readOnly hidden />
            <label>Current password<input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
            <label>New password<input type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required /></label>
            <label>New password again<input type="password" autoComplete="new-password" minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} required /></label>
            <button className="primary" disabled={busy === 'password'}>{busy === 'password' ? 'Saving…' : 'Change password'}</button>
          </form>
          {msgFor('password')}
        </section>

        <section>
          <h3>Devices</h3>
          <p className="muted">Staying signed in lasts 30 days on each device. If you used Sensa on a phone or computer that isn't yours, sign it out from here.</p>
          <div className="acct-row">
            <button disabled={busy === 'others'} onClick={() => run('others', async () => { await post('signout-others'); return 'Every other device has been signed out.'; })}>Sign out other devices</button>
            <button onClick={async () => { await post('logout').catch(() => {}); forget(); location.reload(); }}>Sign out here</button>
          </div>
          {msgFor('others')}
        </section>

        <section>
          <h3>Your data</h3>
          <p className="muted">Your watchlist with its notes and levels, your paper account, your trade journal and your chart drawings, as one file.</p>
          <div className="acct-row"><button onClick={download} disabled={busy === 'data'}><Icon name="download" /> Download my data</button></div>
          {msgFor('data')}
        </section>

        {!me.admin && (
          <section className="danger">
            <h3>Delete account</h3>
            {!leaving ? (
              <>
                <p className="muted">Removes your account, watchlist, paper account, trade journal and drawings for good. The shared data is not affected.</p>
                <div className="acct-row"><button className="danger-btn" onClick={() => setLeaving(true)}>Delete my account…</button></div>
              </>
            ) : (
              <form
                className="acct-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  run('delete', async () => {
                    await post('delete', { current: leavePassword });
                    forget();
                    location.reload();
                  });
                }}
              >
                <label>Your password<input type="password" autoComplete="current-password" value={leavePassword} onChange={(e) => setLeavePassword(e.target.value)} required /></label>
                <label className="check"><input type="checkbox" checked={leaveSure} onChange={(e) => setLeaveSure(e.target.checked)} /> I understand this can't be undone</label>
                <div className="acct-row">
                  <button className="danger-btn" disabled={!leaveSure || busy === 'delete'}>{busy === 'delete' ? 'Deleting…' : 'Delete my account'}</button>
                  <button type="button" className="plain" onClick={() => { setLeaving(false); setLeavePassword(''); setLeaveSure(false); }}>Keep my account</button>
                </div>
              </form>
            )}
            {msgFor('delete')}
          </section>
        )}
      </div>
    </div>
  );
}
