# NSE Screener

End-of-day stock screener for every company listed on the NSE.

```bash
npm install
npm run sync   # download/refresh NSE data (first run fetches ~14 months, ~100 MB cached in data/raw)
npm run dev
```

The "Refresh data" button in the app re-runs the sync through the dev server. NSE publishes each day's file in the evening (IST).

## Brief, watchlist and forward log

The app opens on the **Brief** tab: what newly matched each followed screen, what dropped off, and anything notable on your watchlist (level crossed, 52-week high/low, big move, volume spike, upcoming ex-date).

```bash
npm run brief                  # refresh data, rebuild the brief, update the log
scripts/schedule.sh install    # do that automatically on weekdays at 19:30 (macOS launchd)
scripts/schedule.sh uninstall
```

- **Watchlist**: click the ☆ next to any stock; set a note and an alert level in its detail panel. Stored in `data/user/watchlist.json`.
- **Screens in the brief**: three by default; add the Screener's current criteria from the bottom of the Brief tab. Stored in `data/user/screens.json`.
- **Forward log** (`data/user/log.json`): every new match is recorded on the day it happens, then scored at 5, 10 and 20 sessions (bought at the next open, compared with the average liquid stock). It is never backfilled, so unlike a backtest it has no hindsight in it. Each day's brief is also archived in `data/user/briefs/`.

`data/user` is your own state; nothing regenerates it, so back it up if it matters.

## Running in the cloud

- **Nightly run**: `.github/workflows/brief.yml` builds the brief on GitHub Actions on weekdays at 19:30 and 22:00 IST, commits `data/user`, and publishes the app to Cloudflare Pages. Downloaded NSE files live in the Actions cache. The repo is the master copy of the forward log, so `git pull` before running the brief locally.
- **Hosted app**: Cloudflare Pages project `nse-screener`. `functions/_middleware.js` puts the whole site behind one password (the `APP_PASSWORD` secret). `functions/api/user/[name].js` stores the watchlist and brief screens in the `USER` KV namespace, which the nightly run reads before building the brief.
- **Not available hosted**: Refresh data, Update brief and custom backtests; they need the local dev server. A watchlist change shows up in the next evening's brief.
- **Secrets**: `APP_PASSWORD` on the Pages project; `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the GitHub repo. Until the GitHub secrets exist the workflow skips publishing.
- **Local test of the hosted build**: `npm run build && npx wrangler pages dev dist --kv USER` with `APP_PASSWORD` in `.dev.vars`.

## Backtest

```bash
npm run backtest   # first run downloads ~3 years of history (~235 MB in data/raw)
```

Replays the preset screens (`src/presets.json`, shared with the app) over history and writes `public/data/backtest.json`, shown in the Backtest tab. A signal is the first day a stock matches; entry is the next open, exit the close 5/10/20 sessions after the signal; results are compared with the average of all stocks with ₹1 Cr+ turnover over the same dates. No costs or slippage, and only currently listed companies are tested (survivorship bias).

**Custom screens.** In the app, set criteria in the Screener, click "Backtest this screen", and choose a holding period, optional stop-loss and profit target, and round-trip costs. This runs through the dev server (`/api/backtest`), which keeps the history in memory after the first run; runs are kept in the browser for side-by-side comparison. The trade model lives in `scripts/engine.mjs`.

**Rule search.** `npm run search` tests 1,260 combinations (entry rule × trend filter × liquidity floor × holding period × exit) after 0.3% costs, picks the ones that look good before 1 Oct 2025, and re-checks only those on the year after. Output goes to the console and `public/data/search.json`.

## Data

All from the NSE archive, one set of files per trading session, cached in `data/raw`:

- **Prices, volume, delivery %**: the full bhavcopy (`sec_bhavdata_full_DDMMYYYY.csv`), series EQ/BE/BZ, limited to symbols in NSE's company master so ETFs and bonds are excluded.
- **Corporate actions**: `bc*.csv` inside `PRddmmyy.zip`. Splits, bonuses, rights issues, demergers and dividends with ex-dates, including ones announced up to about six sessions ahead.
- **Market cap and issued shares**: `mcap*.csv` inside the same zip (kept for the first session of each month and the latest three).
- **P/E**: `PE_ddmmyy.csv` (available from 2024).
- **Index membership and sector**: NSE index constituent lists. Only the ~750 Nifty Total Market stocks carry a sector.

- **Derivatives**: the F&O bhavcopy (both the pre- and post-July 2024 formats), `fao_participant_oi_*.csv`, `ind_close_all_*.csv` and `fo_secban.csv`. Each session's 6 MB bhavcopy is reduced to a small summary in `data/raw/fo/` by `scripts/derivatives.mjs`.
- **Filings**: `an*.txt` (announcements) and `bm*.txt` (board meetings) inside the PR zip, kept for the last 12 sessions.
- **Headlines**: public RSS feeds from Economic Times, Mint, Business Standard, BusinessLine and CNBC-TV18. Only headline, blurb, source and link are stored (`scripts/news.mjs`).

`scripts/sync.mjs` writes `public/data/screener.json` (one row per stock) and `public/data/h/<SYMBOL>.json` (price history and corporate actions for the detail panel). Both are generated and git-ignored. `scripts/fundamentals.mjs` holds the corporate-action, market-cap and P/E loaders.

## How the numbers are built

- **Price adjustment**: earlier prices are scaled at each official split, bonus, rights issue and demerger. Splits and bonuses use the announced ratio and are only applied where the opening gap confirms them, on the stated ex-date or within five sessions (ex-dates get revised). Demergers carry no ratio, so the opening gap is used. A stock that opens more than 23% down with no official action on record is still adjusted and marked "inferred". Dividends are not adjusted.
- **Relative strength (RS)** = each stock's weighted return (40% last 3 months, 20% each for 6, 9 and 12 months) ranked 1–99 across all stocks; needs six months of history.
- **Market section of the brief**: breadth and leadership across stocks with ₹1 Cr+ daily turnover, using the median stock in each size group and sector (not index levels).
- **Futures position** on F&O stocks: open interest is summed across expiries; a day counts as long build-up (price up, OI up 3%+), short build-up (price down, OI up), short covering (price up, OI down 3%+) or long unwinding (price down, OI down). Not flagged in a stock's first 20 sessions in F&O.
- **IV** = at-the-money implied volatility (Black-Scholes, 6.5% rate) from the nearest expiry with 3+ days left; **IV rank** = share of the past year's sessions with a lower IV.
- **Index positioning** in the Brief: put/call ratio, max pain, and the strikes with the most put OI below and call OI above the price for the nearest expiry; net index-futures positions by participant type.
- **EPS** = price / P/E. **Earnings growth** = trailing earnings (market cap / P/E) versus 252 sessions earlier. **Dividend yield** = dividends with an ex-date in the last 12 months / price.
- **Large / mid / small cap** = market-cap rank 1–100 / 101–250 / the rest.

## Limits

- End-of-day only; no intraday or live quotes.
- Fundamentals are limited to what NSE publishes daily: market cap, P/E and dividends. There is no balance-sheet or income-statement data (debt, ROE, margins, revenue, book value). Loss-making companies have no P/E.
- Earnings growth is derived from two P/E readings a year apart, so it is approximate and swings wildly when the earlier earnings were near zero.
- P/E history starts in 2024 and market-cap snapshots in Feb 2024, so backtests on fundamentals cover a shorter period than price-only ones.
