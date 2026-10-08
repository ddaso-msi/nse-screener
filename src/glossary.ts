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
  roe: ['Return on equity (ROE)', "The last year's profit as a share of the money shareholders have in the business. 20% means ₹20 of profit for every ₹100 of shareholders' money. Higher is better, but heavy borrowing can inflate it."],
  de: ['Debt to equity', "What the company has borrowed, compared with shareholders' money. 0.5 means ₹50 of borrowings for every ₹100 of equity. Above 1 is heavy for most businesses; it is not meaningful for banks, whose business is borrowing and lending."],
  opm: ['Operating margin', 'How much of each ₹100 of sales is left after the costs of running the business, before interest, depreciation and tax. It shows how profitable the core business is.'],
  promoter: ['Promoter holding', "The share of the company owned by its founders and controlling group. Promoters buying more is usually read as confidence; steady selling deserves a look at why."],
  pledge: ['Pledged shares', "Promoter shares given to lenders as security for loans. If the price falls, lenders can sell them, which pushes the price down further. A high pledged share is a risk."],
  deals: ['Bulk and block deals', 'Large trades the exchange publishes with the names of the buyer and seller. A bulk deal is more than 0.5% of a company traded by one client in a day; a block deal is a single large trade done in a special window.'],
  flows: ['FII and DII flows', 'How much foreign institutions (FIIs) and domestic institutions such as mutual funds and insurers (DIIs) bought or sold in the cash market today, net, in ₹ crore.'],
  valuation: ['Index P/E', "The index's price divided by its companies' earnings. Sensa shows where today's figure sits within its own range over the period it has data for."],
  futOi: ['Futures open interest (OI)', 'The number of futures contracts still open. Rising OI with a rising price (long build-up) suggests new buyers; rising OI with a falling price (short build-up) suggests new sellers.'],
  pcr: ['Put/call ratio (PCR)', 'Open puts divided by open calls. Above 1 means more puts are open than calls; traders read it as a rough gauge of how cautious the options market is.'],
  ivRank: ['Implied volatility (IV) and IV rank', 'IV is how much movement option prices expect. IV rank compares today’s IV with the past year: near 100 means options are unusually expensive, near 0 unusually cheap.'],
  maxPain: ['Max pain', 'The expiry price at which option buyers, in total, would lose the most. Some traders watch it; it is not a forecast.'],
  breadth: ['Market breadth', 'How many stocks are taking part in a move. If most stocks are above their 200-day average, the market is broadly healthy even if the index is flat.'],
  nav: ['NAV and price vs NAV', "An ETF's NAV is the value of what it holds per unit. Price vs NAV shows whether the market price is above (+, you overpay) or below (−) that value."],
  ter: ['Yearly cost (expense ratio)', 'What a fund charges each year as a share of your holding, taken out of its value a little every day. 0.05% costs ₹50 a year on ₹1 lakh.'],
  paper: ['Paper trading', 'Practice trading with virtual money. Orders fill at the next session’s opening price using real market data, so you can test your decisions without risk.'],
  r: ['R (risk multiple)', 'Profit or loss measured in units of what you risked. If your stop put ₹2,000 at risk and you made ₹5,000, that is +2.5R; being stopped out is −1R. It lets you compare trades of different sizes.'],
  odds: ['Prediction market', 'A market where people trade on whether something will happen. A share pays $1 if it does and nothing if it does not, so a price of 70¢ means traders together put the chance at about 70%. Sensa shows a few such prices from Polymarket as background.'],
  backtest: ['Backtest', 'Replaying a rule over past data to see how it would have done. A good backtest is a reason to watch a rule, not proof it will keep working.'],
  pattern: ['Chart patterns', 'Shapes in a price chart, such as a tight base near highs or a cup with handle, that traders watch for. Sensa finds them with fixed rules.'],
} as const;

export type Term = keyof typeof GLOSSARY;
