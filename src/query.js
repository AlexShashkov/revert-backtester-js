const superagent = require('superagent');

async function query(endpoint, q){
    console.log("MAKING QUERY", q);
    let res = await superagent
        .post(endpoint)
        .send({"query":q})
        .set('Content-Type', 'application/json; charset=utf-8')
    return res.body;
}

function deepMerge(...objects) {
    //  recursively merges objects
  return objects.reduce((merged, obj) => {
    for (let key in obj) {
      if (obj.hasOwnProperty(key)) {
        if (Object.prototype.toString.call(obj[key]) === '[object Object]') {
          merged[key] = deepMerge(merged[key], obj[key]);
        } else {
          merged[key] = obj[key];
        }
      }
    }
    return merged;
  }, {});
}

async function getTokenHourPrices(endpoint, token0_address, token1_address){
    /*Gets hourly prices for `token0-address` and `token1-adddress`
        in `network` ('mainnet', 'polygon') from the graph  and returns
        a map with shape:
        {token0-address {timestamp usd-price..,}
        token1-address {timestamp usd-price..,}}
    */
    let q0 = `
        {
            tokenHourDatas(orderBy: periodStartUnix,
            orderDirection: desc,
            where: {token:"${token0_address}"}
            first: 1000,
            subgraphError: allow) {
                periodStartUnix,
                token {id},
                priceUSD
            }
        }
    `;
    let q1 = `
        {
            tokenHourDatas(orderBy: periodStartUnix,
            orderDirection: desc,
            where: {token:"${token1_address}"}
            first: 1000,
            subgraphError: allow) {
                periodStartUnix,
                token {id},
                priceUSD
            }
        }
    `;
    let t0 = await query(endpoint, q0);
    let t1 = await query(endpoint, q1);
    t0 = t0.data;
    t1 = t1.data;
    let tokenPricesToken0 = t0.tokenHourDatas.map(x => ({
        [x.token.id.toLowerCase()]: {
        [x.periodStartUnix]: x.priceUSD
        }
    }));

    let tokenPricesToken1 = t1.tokenHourDatas.map(x => ({
        [x.token.id.toLowerCase()]: {
        [x.periodStartUnix]: x.priceUSD
        }
    }));

    let tokenPrices = deepMerge(...tokenPricesToken0, ...tokenPricesToken1);
    return tokenPrices;
}

async function getPoolsHoursData(endpoint, pool, token0_address, token1_address){
    /*
      For a Uniswap v3 `pool-address` and its underlying
      assets `token0-address` and `token1-address` get
      the pool states for the latest 1000 recorded periods.
    */
    // TODO: Expand to more than 1000 records
    let q = `
        {
          poolHourDatas(orderBy: periodStartUnix,
                       orderDirection: desc,
                       where: {pool: "${pool}"}
                       first: 1000,
                       subgraphError: allow) {
             id
             periodStartUnix,
             pool {id,
             token0 {
                 id,
                symbol,
                name,
                decimals

             },
             token1 {
                 id,
                symbol,
                name,
                decimals
             }
             feeTier},
             liquidity,
             sqrtPrice,
             token0Price,
             token1Price,
             tick,
             tvlUSD,
             volumeToken0,
             volumeToken1
             volumeUSD,
             open,
             high,
             low,
             close
             txCount,
             feeGrowthGlobal0X128,
             feeGrowthGlobal1X128
           }
        }`
    let hours = await query(endpoint, q);
    hours = hours["data"]["poolHourDatas"];
    let tokenPrices = await getTokenHourPrices(endpoint, token0_address, token1_address);

    // console.log("HOURS", hours);
    // console.log(hours[0]["pool"]["token0"])
    // console.log(hours[0]["pool"]["token1"])
    // console.log("TOKEN PRICES", tokenPrices);

    hours = hours.map(h => {
        let dateTs = h.periodStartUnix;
        let token0 = h.pool.token0.id.toLowerCase();
        let token1 = h.pool.token1.id.toLowerCase();
        let price0_usd = new Number(tokenPrices[token0][dateTs]);
        let price1_usd = new Number(tokenPrices[token1][dateTs]);
        return {
            "exchange": "uniswapv3",
            "address": h["pool"]["id"],
            "fee-tier": h["pool"]["feeTier"],
            "date": dateTs,
            "token0-decimals": parseInt(h["pool"]["token0"]["decimals"]),
            "token0-symbol": h["pool"]["token0"]["symbol"],
            "token0-name": h["pool"]["token0"]["name"],
            "token0-address": token0_address,
            "token1-decimals": parseInt(h["pool"]["token1"]["decimals"]),
            "token1-symbol": h["pool"]["token1"]["symbol"],
            "token1-name": h["pool"]["token1"]["name"],
            "token1-address": token1_address,
            "reserves-usd": parseFloat(h["tvlUSD"]),
            "volume-usd": parseFloat(h["volumeUSD"]),
            "volume0": parseFloat(h["volumeToken0"]),
            "volume1": parseFloat(h["volumeToken1"]),
            "fee-growth-global0": parseFloat(h["feeGrowthGlobal0X128"]),
            "fee-growth-global1": parseFloat(h["feeGrowthGlobal1X128"]),
            "open": parseFloat(h["open"]),
            "high": parseFloat(h["high"]),
            "low": parseFloat(h["low"]),
            "close": parseFloat(h["close"]),
            "liquidity": parseFloat(h["liquidity"]),
            "token0-price": parseFloat(h["token0Price"]),
            "token1-price": parseFloat(h["token1Price"]),
            "token0-price-usd": price0_usd,
            "token1-price-usd": price1_usd,
            "sqrt-price": h["sqrtPrice"],
            "tick": parseInt(h["tick"]),
            "timestamp": new Date(dateTs * 1000)
        };
    });
    return hours;
}

async function getHistoricStates(endpoint, pool, token0_address, token1_address) {
    /* For a Uniswap v3 `pool-address` and its underlying
    assets `token0-address` and `token1-address` get
    the pool states for the latest 1000 recorded periods, and drop
    any record that does not have recored ticks/prices */

    let res = await getPoolsHoursData(endpoint, pool, token0_address, token1_address);
    res = res.reverse().filter(h =>
        h["close"] != 0 &&
        h["low"] != 0 &&
        h["high"] != 0 &&
        h["tick"] !== null
    );
    return res;
}


module.exports = { query, getPoolsHoursData, getHistoricStates};
