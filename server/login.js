// The sign-in page, served by the middleware to anyone without a session.
export const loginPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Sensa · Sign in</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    display: grid; place-items: center; padding: 24px;
    font: 15px/1.45 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #fff;
    background: radial-gradient(110% 80% at 50% -8%, #2a4fc2 0%, #1a2f7c 30%, #101a45 58%, #080c1c 100%);
  }
  main { width: min(380px, 100%); text-align: center; }
  .logo { display: inline-grid; place-items: center; width: 56px; height: 56px; border-radius: 17px; background: linear-gradient(135deg, #3d6bff, #6a5cf0); box-shadow: 0 14px 40px -8px rgb(61 107 255 / .75); }
  h1 { margin: 20px 0 6px; font-size: 44px; font-weight: 750; letter-spacing: -.045em; line-height: 1; }
  p { margin: 0; color: rgb(255 255 255 / .75); }
  .tabs { display: flex; gap: 2px; margin: 28px 0 14px; padding: 3px; background: rgb(255 255 255 / .08); border-radius: 11px; }
  .tabs button { flex: 1; padding: 8px; border: 0; border-radius: 8px; background: none; color: rgb(255 255 255 / .7); font: inherit; font-weight: 550; cursor: pointer; }
  .tabs button[aria-selected="true"] { background: rgb(255 255 255 / .16); color: #fff; }
  form { display: grid; gap: 10px; text-align: left; }
  label { display: grid; gap: 5px; font-size: 12.5px; color: rgb(255 255 255 / .75); }
  input { padding: 11px 12px; border-radius: 10px; border: 1px solid rgb(255 255 255 / .2); background: rgb(255 255 255 / .08); color: #fff; font: inherit; }
  input:focus { outline: 0; border-color: #9dbaff; box-shadow: 0 0 0 3px rgb(157 186 255 / .25); }
  button[type="submit"] { margin-top: 6px; padding: 11px; border: 0; border-radius: 10px; background: #fff; color: #14235e; font: inherit; font-weight: 650; cursor: pointer; }
  button[type="submit"]:disabled { opacity: .6; cursor: default; }
  .error { min-height: 20px; color: #ffc2c2; font-size: 13px; text-align: center; }
  small { display: block; margin-top: 4px; color: rgb(255 255 255 / .55); font-size: 12px; }
  [hidden] { display: none !important; }
  .google { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 28px; padding: 11px; border-radius: 10px; background: #fff; color: #1f1f1f; font-weight: 600; text-decoration: none; }
  .or { display: flex; align-items: center; gap: 12px; margin: 18px 0 -10px; color: rgb(255 255 255 / .5); font-size: 12px; }
  .or::before, .or::after { content: ""; flex: 1; height: 1px; background: rgb(255 255 255 / .18); }
  .who { margin-top: 26px; padding: 10px 12px; border-radius: 10px; background: rgb(255 255 255 / .08); font-size: 13px; }
</style>
</head>
<body>
<main>
  <span class="logo" aria-hidden="true"><svg viewBox="0 0 24 24" width="34" height="34"><path d="M3 17l5-6 4 3 6-9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="18" cy="5" r="2.2" fill="#fff"/></svg></span>
  <h1>Sensa</h1>
  <p>The Indian market, after the bell.</p>

  <div id="google" hidden>
    <a class="google" href="/api/auth/google">
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.500-4.800 7.200l7.700 6c4.500-4.200 6.900-10.300 6.900-17.700z"/><path fill="#FBBC05" d="M10.5 28.600a14.500 14.500 0 0 1 0-9.200l-7.900-6.200a24 24 0 0 0 0 21.600z"/><path fill="#34A853" d="M24 48c6.500 0 11.900-2.100 15.900-5.800l-7.700-6c-2.200 1.500-5 2.300-8.200 2.300-6.300 0-11.600-4.100-13.500-9.900l-7.900 6.200C6.500 42.600 14.600 48 24 48z"/></svg>
      Continue with Google
    </a>
    <div class="or">or</div>
  </div>

  <form id="finish" hidden>
    <p class="who">Signed in to Google as <b id="email"></b>. Choose a name and enter your invite code to finish.</p>
    <label>Name <input name="name" autocapitalize="none" spellcheck="false" required minlength="3" maxlength="20"></label>
    <label>Invite code <input name="invite" type="password" autocomplete="off" required><small>The code the site's owner gave you. You only need it this once.</small></label>
    <div class="error" id="finish-error" role="alert"></div>
    <button type="submit" id="finish-go">Create account</button>
  </form>

  <div class="tabs" role="tablist" id="tabs">
    <button role="tab" id="tab-login" aria-selected="true">Sign in</button>
    <button role="tab" id="tab-signup" aria-selected="false">Create account</button>
  </div>

  <form id="form">
    <label>Name <input name="name" autocomplete="username" autocapitalize="none" spellcheck="false" required minlength="3" maxlength="20"></label>
    <label>Password <input name="password" type="password" autocomplete="current-password" required minlength="8"></label>
    <label id="invite" hidden>Invite code <input name="invite" type="password" autocomplete="off"><small>The code the site's owner gave you.</small></label>
    <div class="error" id="error" role="alert"></div>
    <button type="submit" id="go">Sign in</button>
  </form>
</main>
<script>
  let mode = 'login';
  const $ = (id) => document.getElementById(id);
  const form = $('form');
  const googleOn = __GOOGLE__, pendingEmail = __PENDING__;
  $('google').hidden = !googleOn || !!pendingEmail;
  const problem = new URLSearchParams(location.search).get('signin');
  if (pendingEmail) {
    // came back from Google with an account we have not seen: ask for a name and the invite code
    $('email').textContent = pendingEmail;
    $('finish').hidden = false;
    form.hidden = true;
    $('tabs').hidden = true;
    $('finish').onsubmit = async (e) => {
      e.preventDefault();
      $('finish-go').disabled = true;
      $('finish-error').textContent = '';
      try {
        const f = $('finish');
        const res = await fetch('/api/auth/google-finish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: f.name.value, invite: f.invite.value }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Something went wrong. Try again.');
        location.replace('/');
      } catch (err) {
        $('finish-error').textContent = err.message;
        $('finish-go').disabled = false;
      }
    };
  }
  function show(next) {
    mode = next;
    $('tab-login').setAttribute('aria-selected', String(mode === 'login'));
    $('tab-signup').setAttribute('aria-selected', String(mode === 'signup'));
    $('invite').hidden = mode !== 'signup';
    form.invite.required = mode === 'signup';
    form.password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    $('go').textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    $('error').textContent = '';
  }
  if (problem) { $('error').textContent = problem; history.replaceState(null, '', '/'); }
  $('tab-login').onclick = () => show('login');
  $('tab-signup').onclick = () => show('signup');
  form.onsubmit = async (e) => {
    e.preventDefault();
    $('go').disabled = true;
    $('error').textContent = '';
    try {
      const res = await fetch('/api/auth/' + mode, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: form.name.value, password: form.password.value, invite: form.invite.value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Something went wrong. Try again.');
      location.reload();
    } catch (err) {
      $('error').textContent = err.message;
      $('go').disabled = false;
    }
  };
</script>
</body>
</html>`;
