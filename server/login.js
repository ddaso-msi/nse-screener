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
  [hidden] { display: none; }
</style>
</head>
<body>
<main>
  <span class="logo" aria-hidden="true"><svg viewBox="0 0 24 24" width="34" height="34"><path d="M3 17l5-6 4 3 6-9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="18" cy="5" r="2.2" fill="#fff"/></svg></span>
  <h1>Sensa</h1>
  <p>The Indian market, after the bell.</p>

  <div class="tabs" role="tablist">
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
