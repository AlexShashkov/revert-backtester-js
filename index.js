const q = require("./src/query");
const bt = require("./src/backtester");

const endpoint = "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3";
const pool = "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640";
const token0 = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const token1 = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

(async () => {
    let states = await q.getHistoricStates(endpoint, pool, token0, token1);

    let lastState = states[states.length-1];

    let dlast = new Date(lastState.timestamp);
    let dfirst = new Date(dlast);
    dfirst.setDate(dfirst.getDate() - 30);

    let firstState = states.find(item => {
      let itemDate = new Date(item.timestamp);
      return itemDate.getUTCFullYear() === dfirst.getUTCFullYear() &&
             itemDate.getUTCMonth() === dfirst.getUTCMonth() &&
             itemDate.getUTCDate() === dfirst.getUTCDate();
    });

    console.log("Before cleanup", states.length);
    let firstStateIndex = states.indexOf(firstState);
    states = states.slice(firstStateIndex);
    console.log("After cleanup", states.length);

    console.log("first state", firstState);
    let backtest_results = bt.backtesterPosition(states, 
                                        197700, 198110, "300000000042970",
                                        firstState["timestamp"], "token0");
    console.log(backtest_results[0]);
    console.log(backtest_results[backtest_results.length-1]);

    let sum = backtest_results.reduce((accumulator, currentState) => {
    for (let property in currentState) {
        if (currentState.hasOwnProperty(property) && typeof currentState[property] === 'number') {
            accumulator[property] = (accumulator[property] || 0) + currentState[property];
        }
    }
    return accumulator;
    }, {});
    console.log("sum", sum);

})().catch(e => {
    console.log("error", e);
});
