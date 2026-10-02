// Sign up, sign in, sign out, "who am I", and change password.
import {
  NAME_RULE, clearCookie, dropCookie, hashPassword, json, newSalt, readTempCookie, same, sessionCookie, sessionUser, tempCookie, tooManyTries,
} from '../../../server/auth.js';

const MIN_PASSWORD = 8;

async function body(request) {
  try {
    const b = await request.json();
    return typeof b === 'object' && b ? b : {};
  } catch {
    return {};
  }
}

const redirect = (location, cookies = []) => {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status: 302, headers });
};

// Google sign-in (OAuth 2 authorisation-code flow). Enabled when the
// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET secrets are set. A Google account
// only proves who someone is; the first time, they still need the invite code.
async function google(action, request, env) {
  const url = new URL(request.url);
  const callback = `${url.origin}/api/auth/google-callback`;

  if (action === 'google') {
    const state = crypto.randomUUID();
    const to = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    to.search = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, redirect_uri: callback, response_type: 'code', scope: 'openid email', state, prompt: 'select_account',
    }).toString();
    return redirect(to.toString(), [await tempCookie(env, 'sensa_oauth', state)]);
  }

  if (action === 'google-callback') {
    const fail = (why) => redirect(`/?signin=${encodeURIComponent(why)}`, [dropCookie('sensa_oauth')]);
    const state = await readTempCookie(env, request, 'sensa_oauth');
    if (!state || state !== url.searchParams.get('state') || !url.searchParams.get('code')) return fail('Google sign-in was cancelled or timed out. Try again.');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: url.searchParams.get('code'), client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: callback, grant_type: 'authorization_code',
      }),
    });
    const token = await res.json().catch(() => null);
    if (!res.ok || !token?.id_token) return fail('Google did not confirm the sign-in. Try again.');
    // the ID token came straight from Google over TLS in exchange for our secret, so its contents can be trusted
    let who;
    try {
      who = JSON.parse(atob(token.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch {
      return fail('Google did not confirm the sign-in. Try again.');
    }
    if (who.aud !== env.GOOGLE_CLIENT_ID || !who.sub || !who.email_verified) return fail('That Google account could not be verified.');
    const name = await env.USER.get(`g:${who.sub}`);
    if (name && (await env.USER.get(`acct:${name}`))) return redirect('/', [await sessionCookie(env, name), dropCookie('sensa_oauth')]);
    // first time with this Google account: finish on the sign-in page with a name and the invite code
    return redirect('/', [await tempCookie(env, 'sensa_pending', JSON.stringify({ sub: who.sub, email: who.email }), 900), dropCookie('sensa_oauth')]);
  }

  if (action === 'google-finish' && request.method === 'POST') {
    const pending = JSON.parse((await readTempCookie(env, request, 'sensa_pending')) ?? 'null');
    if (!pending?.sub) return json({ error: 'Start again with "Continue with Google".' }, 400);
    const b = await body(request);
    const name = String(b.name ?? '').trim().toLowerCase();
    if (!env.APP_PASSWORD || !(await same(String(b.invite ?? ''), env.APP_PASSWORD))) return json({ error: 'That invite code is not right.' }, 403);
    if (!NAME_RULE.test(name)) return json({ error: 'Choose a name of 3–20 letters, numbers, - or _.' }, 400);
    if (await env.USER.get(`acct:${name}`)) return json({ error: 'That name is taken.' }, 409);
    await env.USER.put(`acct:${name}`, JSON.stringify({ google: pending.sub, email: pending.email, created: new Date().toISOString() }));
    await env.USER.put(`g:${pending.sub}`, name);
    if (!(await env.USER.get('sys:admin'))) await env.USER.put('sys:admin', name);
    const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
    headers.append('set-cookie', await sessionCookie(env, name));
    headers.append('set-cookie', dropCookie('sensa_pending'));
    return new Response(JSON.stringify({ name }), { headers });
  }
  return json({ error: 'Not found' }, 404);
}

export async function onRequest({ request, env, params }) {
  const action = params.action;

  if (action.startsWith('google')) {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return json({ error: 'Google sign-in is not set up.' }, 404);
    return google(action, request, env);
  }

  if (action === 'me' && request.method === 'GET') {
    const name = await sessionUser(env, request);
    if (!name) return json({ error: 'Not signed in' }, 401);
    return json({ name, admin: (await env.USER.get('sys:admin')) === name });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (action === 'logout') return json({ ok: true }, 200, { 'set-cookie': clearCookie });

  const b = await body(request);
  const name = String(b.name ?? '').trim().toLowerCase();
  const password = String(b.password ?? '');

  if (action === 'signup') {
    // the site password doubles as the invitation: only people given it can make an account
    if (!env.APP_PASSWORD || !(await same(String(b.invite ?? ''), env.APP_PASSWORD))) return json({ error: 'That invite code is not right.' }, 403);
    if (!NAME_RULE.test(name)) return json({ error: 'Choose a name of 3–20 letters, numbers, - or _.' }, 400);
    if (password.length < MIN_PASSWORD) return json({ error: `Choose a password of at least ${MIN_PASSWORD} characters.` }, 400);
    if (await env.USER.get(`acct:${name}`)) return json({ error: 'That name is taken.' }, 409);
    const salt = newSalt();
    await env.USER.put(`acct:${name}`, JSON.stringify({ salt, hash: await hashPassword(password, salt), created: new Date().toISOString() }));
    if (!(await env.USER.get('sys:admin'))) await env.USER.put('sys:admin', name);
    return json({ name }, 200, { 'set-cookie': await sessionCookie(env, name) });
  }

  if (action === 'login') {
    if (!NAME_RULE.test(name)) return json({ error: 'Wrong name or password.' }, 401);
    if (await tooManyTries(env, name)) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
    const acct = await env.USER.get(`acct:${name}`, 'json');
    // hash even when the account does not exist, so both cases take the same time
    const hash = await hashPassword(password, acct?.salt ?? 'no-such-account');
    // accounts made with Google have no password and can only be entered through Google
    if (!acct?.hash || !(await same(hash, acct.hash))) return json({ error: 'Wrong name or password.' }, 401);
    return json({ name }, 200, { 'set-cookie': await sessionCookie(env, name) });
  }

  if (action === 'password') {
    const me = await sessionUser(env, request);
    if (!me) return json({ error: 'Not signed in' }, 401);
    const acct = await env.USER.get(`acct:${me}`, 'json');
    if (!acct.hash) return json({ error: 'This account signs in with Google and has no password.' }, 400);
    if (!(await same(await hashPassword(String(b.current ?? ''), acct.salt), acct.hash))) return json({ error: 'Your current password is not right.' }, 403);
    if (password.length < MIN_PASSWORD) return json({ error: `Choose a password of at least ${MIN_PASSWORD} characters.` }, 400);
    const salt = newSalt();
    await env.USER.put(`acct:${me}`, JSON.stringify({ ...acct, salt, hash: await hashPassword(password, salt) }));
    return json({ ok: true });
  }

  return json({ error: 'Not found' }, 404);
}
