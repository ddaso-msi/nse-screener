# Sensa to-do

Ordered by what to do first. Tick items off as they land.

## Now

- [x] **Quality pass.** _(2026-10-03: no console errors or sideways overflow on any tab; fixed starred ETFs missing from the Screener watchlist view, needless filings requests for ETFs, and a stray sign-in check in the local app.)_ Every tab (Home, Brief, Screener, ETFs, Chart, Paper, Options, News, Backtest) on desktop and phone width, in light and dark: fix anything broken, clipped, overflowing or inconsistent.
- [x] **First-run guide.** A short welcome after sign-up: what each tab is for, how to star a stock, how paper trading works. Dismissible, can be reopened.
- [x] **Plain-language help.** A "?" beside jargon (delivery %, RS, IV rank, PCR, max pain, futures build-up, price vs NAV) with a one-sentence explanation.
- [x] **Phone layout.** _(compact header, swipeable screen list, filters on request, full-width stock panel, larger tap targets; the Options chain still scrolls sideways by design)_ Make tables, the chart, the option chain and the stock panel comfortable on a phone.

## Next

- [ ] **Account self-service.** Change password and delete account from inside the app.
- [ ] **Custom backtests on the hosted site.** Today they only run on the Mac (`npm run dev`).
- [ ] **Own address.** Move from nse-screener.pages.dev to a Sensa domain. Needs Deb to buy the domain (roughly ₹800–1,500 a year).
- [ ] **Stale-data warning and failure alerts.** Show "data is X days old" in the app; have the nightly job email on failure.

## Later

- [ ] **Trade journal with position sizing.** Record real trades, reasons and stops; review results.
- [ ] **Proper fundamentals.** Debt, ROE, revenue and margin growth from quarterly filings.
- [ ] **Post-results drift study.** Backtest how stocks move in the weeks after results.
- [ ] **Data licence check.** Confirm NSE/AMFI terms before opening the site beyond family and friends.

## Not planned

- Mutual funds (outside the app's audience).
- More indicators or screens (backtests show little edge).
- Anything that needs paid data.
- Google sign-in (removed 2026-10-03; can return later).
