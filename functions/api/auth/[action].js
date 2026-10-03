// Sign up, sign in, sign out, "who am I", and change password.
import { NAME_RULE, clearCookie, hashPassword, json, newSalt, same, sessionCookie, sessionUser, tooManyTries } from '../../../server/auth.js';

const MIN_PASSWORD = 8;

async function body(request) {
  try {
    const b = await request.json();
    return typeof b === 'object' && b ? b : {};
  } catch {
    return {};
  }
}

export async function onRequest({ request, env, params }) {
  const action = params.action;

  if (action === 'me' && request.method === 'GET') {
    const name = await sessionUser(env, request);
    if (!name) return json({ error: 'Not signed in' }, 401);
    const acct = await env.USER.get(`acct:${name}`, 'json');
    return json({ name, admin: (await env.USER.get('sys:admin')) === name, created: acct?.created ?? null });
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
    return json({ name }, 200, { 'set-cookie': await sessionCookie(env, name, 0) });
  }

  if (action === 'login') {
    if (!NAME_RULE.test(name)) return json({ error: 'Wrong name or password.' }, 401);
    if (await tooManyTries(env, name)) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
    const acct = await env.USER.get(`acct:${name}`, 'json');
    // hash even when the account does not exist, so both cases take the same time
    const hash = await hashPassword(password, acct?.salt ?? 'no-such-account');
    if (!acct || !(await same(hash, acct.hash))) return json({ error: 'Wrong name or password.' }, 401);
    return json({ name }, 200, { 'set-cookie': await sessionCookie(env, name, acct.ver ?? 0) });
  }

  if (action === 'password') {
    const me = await sessionUser(env, request);
    if (!me) return json({ error: 'Not signed in' }, 401);
    const acct = await env.USER.get(`acct:${me}`, 'json');
    if (!(await same(await hashPassword(String(b.current ?? ''), acct.salt), acct.hash))) return json({ error: 'Your current password is not right.' }, 403);
    if (password.length < MIN_PASSWORD) return json({ error: `Choose a password of at least ${MIN_PASSWORD} characters.` }, 400);
    // a new password signs out every other device; this one gets a fresh session
    const salt = newSalt();
    const ver = (acct.ver ?? 0) + 1;
    await env.USER.put(`acct:${me}`, JSON.stringify({ ...acct, salt, hash: await hashPassword(password, salt), ver }));
    return json({ ok: true }, 200, { 'set-cookie': await sessionCookie(env, me, ver) });
  }

  if (action === 'signout-others') {
    const me = await sessionUser(env, request);
    if (!me) return json({ error: 'Not signed in' }, 401);
    const acct = await env.USER.get(`acct:${me}`, 'json');
    const ver = (acct.ver ?? 0) + 1;
    await env.USER.put(`acct:${me}`, JSON.stringify({ ...acct, ver }));
    return json({ ok: true }, 200, { 'set-cookie': await sessionCookie(env, me, ver) });
  }

  if (action === 'delete') {
    const me = await sessionUser(env, request);
    if (!me) return json({ error: 'Not signed in' }, 401);
    if ((await env.USER.get('sys:admin')) === me) return json({ error: "The site owner's account can't be deleted from the app." }, 403);
    const acct = await env.USER.get(`acct:${me}`, 'json');
    if (!(await same(await hashPassword(String(b.current ?? ''), acct.salt), acct.hash))) return json({ error: 'Your password is not right.' }, 403);
    await Promise.all([`acct:${me}`, `u:${me}:watchlist`, `u:${me}:paper`, `u:${me}:drawings`, `u:${me}:journal`].map((k) => env.USER.delete(k)));
    return json({ ok: true }, 200, { 'set-cookie': clearCookie });
  }

  return json({ error: 'Not found' }, 404);
}
