// Password gate for the whole site (pages, data and API). The password is the
// APP_PASSWORD secret: `wrangler pages secret put APP_PASSWORD`. Any username
// is accepted. Without the secret the site refuses everything.

const encoder = new TextEncoder();

async function same(a, b) {
  // compare digests so the check takes the same time whatever was sent
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', encoder.encode(s))));
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

export async function onRequest({ request, env, next }) {
  if (!env.APP_PASSWORD) return new Response('Not configured: APP_PASSWORD is not set.', { status: 503 });
  const header = request.headers.get('authorization') ?? '';
  if (header.startsWith('Basic ')) {
    let given = '';
    try {
      const decoded = atob(header.slice(6));
      given = decoded.slice(decoded.indexOf(':') + 1);
    } catch {
      // fall through to the challenge
    }
    if (given && (await same(given, env.APP_PASSWORD))) {
      const res = await next();
      const out = new Response(res.body, res);
      out.headers.set('x-robots-tag', 'noindex');
      return out;
    }
  }
  return new Response('Password required.', {
    status: 401,
    headers: { 'www-authenticate': 'Basic realm="NSE Screener", charset="UTF-8"' },
  });
}
