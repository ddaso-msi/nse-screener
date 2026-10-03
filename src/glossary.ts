// One-sentence explanations of the app's jargon, shown behind the small "?"
// buttons and listed in the help panel. Written for someone new to markets.

export const GLOSSARY = {
  rs: ['Relative strength (RS)', 'A score from 1 to 99 showing how a stock has done over the past year compared with all other stocks, with recent months counting more. 90 means it beat 90% of them.'],
  rsi: ['RSI', 'A 0–100 measure of recent momentum. Above 70 is often called overbought (it has risen fast); below 30, oversold (it has fallen fast).'],
  deliv: ['Delivery %', "The share of the day's traded shares that buyers actually took into their demat accounts, rather than buying and selling the same day. High delivery suggests investors, not just day traders, were buying."],
  volX: ['Volume ×', 'Today’s traded volume compared with the stock’s average over the last 20 sessions. 3× means three times the usual activity.'],
  dma: ['Moving average (50D, 200D)', "The average closing price over the last 50 or 200 sessions. A price above its 200-day average is a common sign of a long-term uptrend."],
  range52: ['52-week range', "Where today's price sits between its lowest and highest prices of the past year."],
  turnover: ['Turnover', 'The value of shares traded in a day, in ₹ crore. Higher turnover means a stock is easier to buy and sell without moving the price.'],
  pe: ['P/E', "Price divided by the last year's earnings per share. A P/E of 20 means you pay ₹20 for every ₹1 the company earned. Loss-making companies have none."],
  futOi: ['Futures open interest (OI)', 'The number of futures contracts still open. Rising OI with a rising price (long build-up) suggests new buyers; rising OI with a falling price (short build-up) suggests new sellers.'],
  pcr: ['Put/call ratio (PCR)', 'Open puts divided by open calls. Above 1 means more puts are open than calls; traders read it as a rough gauge of how cautious the options market is.'],
  ivRank: ['Implied volatility (IV) and IV rank', 'IV is how much movement option prices expect. IV rank compares today’s IV with the past year: near 100 means options are unusually expensive, near 0 unusually cheap.'],
  maxPain: ['Max pain', 'The expiry price at which option buyers, in total, would lose the most. Some traders watch it; it is not a forecast.'],
  breadth: ['Market breadth', 'How many stocks are taking part in a move. If most stocks are above their 200-day average, the market is broadly healthy even if the index is flat.'],
  nav: ['NAV and price vs NAV', "An ETF's NAV is the value of what it holds per unit. Price vs NAV shows whether the market price is above (+, you overpay) or below (−) that value."],
  ter: ['Yearly cost (expense ratio)', 'What a fund charges each year as a share of your holding, taken out of its value a little every day. 0.05% costs ₹50 a year on ₹1 lakh.'],
  paper: ['Paper trading', 'Practice trading with virtual money. Orders fill at the next session’s opening price using real market data, so you can test your decisions without risk.'],
  backtest: ['Backtest', 'Replaying a rule over past data to see how it would have done. A good backtest is a reason to watch a rule, not proof it will keep working.'],
  pattern: ['Chart patterns', 'Shapes in a price chart, such as a tight base near highs or a cup with handle, that traders watch for. Sensa finds them with fixed rules.'],
} as const;

export type Term = keyof typeof GLOSSARY;
