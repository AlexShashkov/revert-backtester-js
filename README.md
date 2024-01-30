# revert-backtester-js
JavaScript version of revert backtester for Uniswap v3 positions using Node.js. [Original implementation](https://github.com/revert-finance/revert-backtester/)

## Using the backtester
```javascript
const q = require("./src/query");
const bt = require("./src/backtester");

const endpoint = "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3";
const pool = "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640";
const token0 = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const token1 = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

(async () => {
    let states = await q.getHistoricStates(endpoint, pool, token0, token1);
    console.log("first state", states[0]);
    let backtest_results = bt.backtesterPosition(states, 
                                        197700, 198110, "300000000042970",
                                        states[0]["timestamp"], "token0");
    console.log(backtest_results[backtest_results.length-1]);
})().catch(e => {
    console.log("error", e);
});
/*
{
  timestamp: 2024-01-17T10:00:00.000Z,
  date: 1705485600,
  amount0: 143.433957,
  amount1: 0.06492459773413031,
  price0: 1,
  price1: 2540.3928972489753,
  liquidity: 300000000042970,
  il: 43.871384747263676,
  pnl: 43.8884081370133,
  apr: 199.11824155690735,
  positionActive: true,
  accumFees0: 0.00750413440371989,
  accumFees1: 0.000003747158699834588,
  fees0: 0.00750413440371989,
  fees1: 0.000003747158699834588
}
*/
```
