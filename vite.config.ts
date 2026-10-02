import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve(import.meta.dirname, 'public/data');

// Dev-only endpoint behind the "Refresh data" button: re-runs the NSE sync.
function syncApi(): Plugin {
  let running: Promise<unknown> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let universe: Promise<any> | null = null;
  return {
    name: 'nse-sync-api',
    configureServer(server) {
      // Generated data is excluded from the file watcher (a sync rewrites thousands
      // of files), so Vite never learns about files created after startup. Serve
      // the folder directly instead.
      server.middlewares.use('/data', async (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (!/^\/[\w/-]+\.json$/.test(rel)) return next();
        try {
          const body = await readFile(path.join(DATA_DIR, rel));
          res.setHeader('content-type', 'application/json');
          res.setHeader('cache-control', 'no-cache');
          res.end(body);
        } catch {
          res.statusCode = 404;
          res.end();
        }
      });
      // Custom-screen backtests. Three years of history is parsed on the first
      // request and kept in memory until the next data refresh.
      server.middlewares.use('/api/backtest', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        res.setHeader('content-type', 'application/json');
        try {
          let raw = '';
          for await (const chunk of req) raw += chunk;
          const body = JSON.parse(raw || '{}');
          const num = (v: unknown, lo: number, hi: number) =>
            typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null;
          const engine = await import('./scripts/engine.mjs');
          universe ??= engine.loadUniverse();
          const u = await universe.catch((err: Error) => {
            universe = null; // retry the load next time
            throw err;
          });
          const stats = engine.run(u, {
            filters: body.filters ?? {},
            hold: Math.round(num(body.hold, 1, 120) ?? 10),
            stop: num(body.stop, 0.1, 90),
            target: num(body.target, 0.1, 1000),
            cost: num(body.cost, 0, 10) ?? 0,
          });
          res.end(JSON.stringify({ from: u.dates[0], to: u.dates[u.dates.length - 1], sessions: u.dates.length, stats }));
        } catch (err) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });

      // Watchlist and the screens the brief follows live in data/user so the
      // nightly job can read them (browser storage would be invisible to it).
      server.middlewares.use('/api/user', async (req, res) => {
        const name = (req.url ?? '').split('?')[0].slice(1);
        if (name !== 'watchlist' && name !== 'screens' && name !== 'paper' && name !== 'drawings') {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader('content-type', 'application/json');
        try {
          const brief = await import('./scripts/brief.mjs');
          if (req.method === 'PUT') {
            let raw = '';
            for await (const chunk of req) raw += chunk;
            const value = JSON.parse(raw);
            if (typeof value !== 'object' || value === null) throw new Error('Expected JSON');
            await brief.writeUser(name, value);
            return res.end(JSON.stringify(value));
          }
          res.end(JSON.stringify(await brief.readUser(name)));
        } catch (err) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });

      // Rebuild the brief from data already on disk (after a watchlist or screen change).
      server.middlewares.use('/api/brief', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        res.setHeader('content-type', 'application/json');
        try {
          const brief = await import('./scripts/brief.mjs');
          res.end(JSON.stringify(await brief.runBrief({ log: () => {}, refresh: false })));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });

      server.middlewares.use('/api/sync', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        res.setHeader('content-type', 'application/json');
        try {
          // a refresh also rebuilds the evening brief and updates the forward log
          running ??= import('./scripts/brief.mjs').then((m) => m.runBrief({ log: () => {} }));
          res.end(JSON.stringify(await running));
          universe = null; // new session available
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: (err as Error).message }));
        } finally {
          running = null;
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), syncApi()],
  server: { watch: { ignored: ['**/public/data/**', '**/data/raw/**'] } },
});
