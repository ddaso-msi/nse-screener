// Accounts and sessions for the hosted site (Cloudflare Pages Functions).
//
//   acct:<name>            { salt, hash, created }   PBKDF2-SHA256 password hash
//   u:<name>:<what>        that user's watchlist, paper account and drawings
//   sys:secret             key used to sign session cookies (generated on first use)
//   sys:admin              the first account created; only it can edit the brief's screens
//
// A session is a signed cookie "name.expiry.signature"; nothing is stored per session.

const enc = new TextEncoder();
const COOKIE = 'sensa_session';
const SESSION_DAYS = 30;
const ITERATIONS = 100000; // the most Workers allow for PBKDF2

export const NAME_RULE = /^[a-z0-9_-]{3,20}$/;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Compares two strings in the same time whatever they contain. */
export async function same(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

async function signingKey(env) {
  let secret = env.SESSION_SECRET ?? (await env.USER.get('sys:secret'));
  if (!secret) {
    secret = b64(crypto.getRandomValues(new Uint8Array(32)));
    await env.USER.put('sys:secret', secret);
  }
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
const sign = async (env, text) => b64(await crypto.subtle.sign('HMAC', await signingKey(env), enc.encode(text)));

export async function sessionCookie(env, name) {
  const body = `${name}.${Date.now() + SESSION_DAYS * 864e5}`;
  return `${COOKIE}=${body}.${await sign(env, body)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}
export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** The signed-in user's name, or null. */
export async function sessionUser(env, request) {
  const raw = (request.headers.get('cookie') ?? '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return null;
  const [name, expiry, signature] = raw.split('.');
  if (!name || !expiry || !signature || !NAME_RULE.test(name) || !(Number(expiry) > Date.now())) return null;
  if (!(await same(signature, await sign(env, `${name}.${expiry}`)))) return null;
  // an account removed by the admin stops working at once
  return (await env.USER.get(`acct:${name}`)) ? name : null;
}

export async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: ITERATIONS }, key, 256));
}
export const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

/** Slows down password guessing: at most `max` tries per name in a 15-minute window. */
export async function tooManyTries(env, name, max = 10) {
  const key = `try:${name}:${Math.floor(Date.now() / 9e5)}`;
  const n = Number((await env.USER.get(key)) ?? 0) + 1;
  await env.USER.put(key, String(n), { expirationTtl: 1800 });
  return n > max;
}

export const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
