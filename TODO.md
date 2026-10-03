# Sensa to-do

Ordered by what to do first. Tick items off as they land.

## Now

- [x] **Quality pass.** _(2026-10-03: no console errors or sideways overflow on any tab; fixed starred ETFs missing from the Screener watchlist view, needless filings requests for ETFs, and a stray sign-in check in the local app.)_ Every tab (Home, Brief, Screener, ETFs, Chart, Paper, Options, News, Backtest) on desktop and phone width, in light and dark: fix anything broken, clipped, overflowing or inconsistent.
- [x] **First-run guide.** A short welcome after sign-up: what each tab is for, how to star a stock, how paper trading works. Dismissible, can be reopened.
- [x] **Plain-language help.** A "?" beside jargon (delivery %, RS, IV rank, PCR, max pain, futures build-up, price vs NAV) with a one-sentence explanation.
- [x] **Phone layout.** _(compact header, swipeable screen list, filters on request, full-width stock panel, larger tap targets; the Options chain still scrolls sideways by design)_ Make tables, the chart, the option chain and the stock panel comfortable on a phone.

## Next

- [x] **Account self-service.** _(2026-10-03: account panel from the name in the header — change password (signs out other devices), sign out other devices, download my data, delete account; the owner's account can't be deleted from the app)_
- [x] **Custom backtests on the hosted site.** _(2026-10-03: they run in the browser on history packed nightly by `scripts/pack.mjs`, with the same engine as the server; results match exactly)_
- [ ] **Own address.** Move from nse-screener.pages.dev to a Sensa domain. Needs Deb to buy the domain (roughly ₹800–1,500 a year).
- [x] **Stale-data warning and failure alerts.** _(2026-10-03: amber banner and date chip once prices are 5+ days old; the nightly job fails if no new session for 5+ days and opens a GitHub issue on any failure)_

## Later

- [x] **Trade journal with position sizing.** _(2026-10-03: Journal tab — capital and risk per trade size the position from the stop; open trades tracked against each close; closed trades reviewed in ₹ and R, broken down by kind of trade; "Add to journal" on every stock panel; per-user, included in the data download and account deletion. Not pushed yet.)_
- [x] **Proper fundamentals.** _(2026-10-03: sales and profit growth, operating margin, ROE and debt to equity from NSE's structured results filings (`scripts/results.mjs`); shown on the stock panel with the last six quarters, usable as Screener filters and in backtests. Open question: whether the filings listing on www.nseindia.com answers from GitHub's servers — check the first nightly run after pushing.)_
- [ ] **Post-results drift study.** Backtest how stocks move in the weeks after results.
- [x] **Data licence check.** _(2026-10-03, read from nseindia.com terms of use (updated 29/10/2025) and copyright policy (21/10/2025), and amfiindia.com terms of use. Not legal advice.)_
  - NSE: content may be viewed and downloaded for personal, non-commercial or educational use with acknowledgement; it may not be reproduced on or stored in another website, or distributed or published, without NSE's prior written permission. Automated collection (scraping, data extraction) is prohibited. Using the data for "gaming, virtual trading or simulation activities" is prohibited outright, which covers the Paper tab.
  - AMFI: personal, non-commercial use only; no publishing, no derivative works, no storing a significant portion of the site.
  - Conclusion: fine as a personal tool on Deb's own Mac; the hosted site, even private for friends, is outside both sets of terms. Opening it wider needs written permission or a data licence (NSE Data & Analytics is NSE's licensing arm) or a licensed data vendor.
  - NSE Data & Analytics domestic tariff effective 1 Apr 2026 (fixed fees per year, per site/medium, before taxes): end-of-day data ₹1,00,000 for the cash market and ₹1,00,000 for F&O; end-of-day corporate data ₹5,00,000; historical trade data ₹1,10,000 per segment; master data ₹2,15,000. Enquiries: marketdata@nse.co.in. Vendor prices not found.
- [ ] **Decide what to do about the licence finding** (Deb's call): keep it private and small, ask NSE for permission/licence, or move to a licensed vendor. Own domain and wider sharing wait on this.

## Not planned

- Mutual funds (outside the app's audience).
- More indicators or screens (backtests show little edge).
- Anything that needs paid data.
- Google sign-in (removed 2026-10-03; can return later).
