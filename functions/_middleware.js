// Everything on the site needs a signed-in account: pages, data files and the
// API. Anyone without a session gets the sign-in page (or a 401 for data and
// API requests). Accounts are created with the invite code, which is the
// APP_PASSWORD secret: `wrangler pages secret put APP_PASSWORD`. Without that
// secret the site refuses everything.
import { json, readTempCookie, sessionUser } from '../server/auth.js';
import { loginPage } from '../server/login.js';

export async function onRequest({ request, env, next, data }) {
  if (!env.APP_PASSWORD) return new Response('Not configured: APP_PASSWORD is not set.', { status: 503 });
  const { pathname } = new URL(request.url);
  if (pathname.startsWith('/api/auth/')) return next();

  const user = await sessionUser(env, request);
  if (user) {
    data.user = user;
    const res = await next();
    const out = new Response(res.body, res);
    out.headers.set('x-robots-tag', 'noindex');
    return out;
  }
  const wantsPage = request.method === 'GET' && (request.headers.get('accept') ?? '').includes('text/html');
  if (!wantsPage) return json({ error: 'Sign in required' }, 401);
  const pending = JSON.parse((await readTempCookie(env, request, 'sensa_pending')) ?? 'null');
  const page = loginPage
    .replace('__GOOGLE__', String(!!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)))
    .replace('__PENDING__', JSON.stringify(pending?.email ?? '').replace(/</g, '\\u003c'));
  return new Response(page, { status: 401, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}
