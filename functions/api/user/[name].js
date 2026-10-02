// Each signed-in user's own watchlist, paper account and chart drawings, plus
// the list of screens the evening brief follows (shared; only the admin edits it).
import defaultScreens from '../../../scripts/default-screens.json';
import { json } from '../../../server/auth.js';

const PERSONAL = {
  watchlist: {},
  drawings: {},
  paper: { start: 1000000, cash: 1000000, orders: [], positions: [], closed: [], equity: [], notices: [], last: null },
};
const MAX_BYTES = 400_000;

export async function onRequest({ request, env, params, data }) {
  const name = params.name;
  const user = data.user; // set by functions/_middleware.js
  const shared = name === 'screens';
  if (!shared && !(name in PERSONAL)) return json({ error: 'Not found' }, 404);
  const key = shared ? 'screens' : `u:${user}:${name}`;
  const admin = (await env.USER.get('sys:admin')) === user;

  if (request.method === 'GET') {
    let value = await env.USER.get(key, 'json');
    // data saved before accounts existed belongs to the first (admin) account
    if (value == null && !shared && admin) value = await env.USER.get(name, 'json');
    return json(value ?? (shared ? defaultScreens : PERSONAL[name]));
  }
  if (request.method === 'PUT') {
    if (shared && !admin) return json({ error: 'Only the site owner can change the screens in the brief.' }, 403);
    const raw = await request.text();
    if (raw.length > MAX_BYTES) return json({ error: 'Too large' }, 413);
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      return json({ error: 'Expected JSON' }, 400);
    }
    if (typeof value !== 'object' || value === null) return json({ error: 'Expected JSON' }, 400);
    await env.USER.put(key, JSON.stringify(value));
    return json(value);
  }
  return json({ error: 'Method not allowed' }, 405);
}
