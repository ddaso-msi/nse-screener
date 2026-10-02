// Watchlist and brief screens, stored in the USER KV namespace. The nightly
// GitHub Action reads the same keys before it builds the brief.
import defaultScreens from '../../../scripts/default-screens.json';

const DEFAULTS = {
  watchlist: {},
  drawings: {},
  screens: defaultScreens,
  paper: { start: 1000000, cash: 1000000, orders: [], positions: [], closed: [], equity: [], notices: [], last: null },
};
const MAX_BYTES = 200_000;
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function onRequest({ request, env, params }) {
  const name = params.name;
  if (!(name in DEFAULTS)) return json({ error: 'Not found' }, 404);

  if (request.method === 'GET') {
    return json((await env.USER.get(name, 'json')) ?? DEFAULTS[name]);
  }
  if (request.method === 'PUT') {
    const raw = await request.text();
    if (raw.length > MAX_BYTES) return json({ error: 'Too large' }, 413);
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      return json({ error: 'Expected JSON' }, 400);
    }
    if (typeof value !== 'object' || value === null) return json({ error: 'Expected JSON' }, 400);
    await env.USER.put(name, JSON.stringify(value));
    return json(value);
  }
  return json({ error: 'Method not allowed' }, 405);
}
