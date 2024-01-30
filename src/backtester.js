const ethers = require('ethers');
const univ3 = require('@uniswap/v3-sdk');
const sdkCore = require('@uniswap/sdk-core');

function getChainIdForNetwork(network) {
    switch (network) {
        case "polygon":
            return 137;
        case "optimism":
            return 10;
        case "arbitrum":
            return 42161;
        default:
            return 1;
    }
}

function tickSpacingByFee(feeTier) {
  switch (String(feeTier)) {
    case "10000":
      return 200;
    case "3000":
      return 60;
    case "500":
      return 10;
    case "100":
      return 1;
    default:
      return null;
  }
}

function floorTick(tick, tickSpacing) {
    return tick - (tick % tickSpacing);
}


function makeToken(chain_id, token_address, token_decimals){
    // Create univ3 Token object
    return new sdkCore.Token(chain_id, token_address, token_decimals);
}

function makePool(token0, token1, fee_tier, sqrt_price, pool_liquidity, pool_tick) {
    // Create univ3 Pool object
    return new univ3.Pool(token0, token1, fee_tier, sqrt_price, pool_liquidity, pool_tick);
}

function makePoolFromState(pool_state) {
    // Takes a `pool-state` dict as the ones
    // passed to `backtest-positioin` and instantiates a
    // v3 pool js object
    let pool_liquidity = pool_state['liquidity'].toFixed();
    let chain_id = getChainIdForNetwork(pool_state["network"]);
    let token0 = makeToken(chain_id, pool_state["token0-address"], pool_state["token0-decimals"]);
    let token1 = makeToken(chain_id, pool_state["token1-address"], pool_state["token1-decimals"]);
    return makePool(token0, token1, parseInt(pool_state["fee-tier"]), pool_state["sqrt-price"], pool_liquidity, pool_state["tick"]);
}

function makePosition(pool, tickLower, tickUpper, liquidity) {
    return new univ3.Position({
            pool: pool,
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidity: liquidity
    });
}

function ethfu(n, u) {
    // Downgrade ethers to 5.7.2, otherwice wont work :clown-emoji
    // u = ethers.BigNumber.from(u);
    return ethers.utils.formatUnits(n, u);
}

function ebn2bn(n, u) {
  return Number(ethfu(n, u));
}


function positionAmount0(position) {
  return Number(position.amount0.toFixed());
}

function positionAmount1(position) {
  return Number(position.amount1.toFixed());
}

function tickToPrice(network, tickIdx, token0Info, token1Info) {
    try {
        if(token0Info && token1Info){
            let chainId = getChainIdForNetwork(network);
            let token0 = makeToken(chainId, token0Info.address, token0Info.decimals);
            let token1 = makeToken(chainId, token1Info.address, token1Info.decimals);
            return univ3.tickToPrice(token0, token1, parseInt(tickIdx)).toFixed(20);
        }
        else{
            return 0;
        }
    }
    catch(err){
        console.log("tick->price:", err);
        return 0;
    }
}

function periodPrices(poolStateCurrent, tickUpper, tickLower) {
    let token0Decimals = poolStateCurrent["token0-decimals"];
    let token1Decimals = poolStateCurrent["token1-decimals"];
    let network = poolStateCurrent.network;
    let token0 = {
        decimals: token0Decimals,
        address: poolStateCurrent["token0-address"]
    };
    let token1 = {
        decimals: token1Decimals,
        address: poolStateCurrent["token1-address"]
    };
    // prices in terms of token1
    let priceLower = Number(tickToPrice(network, tickUpper, token1, token0));
    let priceUpper = Number(tickToPrice(network, tickLower, token1, token0));
    return [priceLower, priceUpper];
}

function dilutionFactor(poolTicks, poolStatePrev, positionLiquidity) {
    let tickSpacing = tickSpacingByFee(poolStatePrev.feeTier);
    let activeTickIdx = String(floorTick(poolStatePrev.tick, tickSpacing));
    let activeTick = poolTicks.find(tick => String(tick.tickIdx) === activeTickIdx);
    // liquidityActive is all the liquidity referencing
    // the tick in question. That is to say, it is all
    // the liquidity that would be awarded fees if
    // swaps happen in that tick.
    let activeLiquidity = activeTick.liquidityActive;
    return activeLiquidity / (positionLiquidity + activeLiquidity);
}

function unboundedFees(poolState, prevPoolState, poolDilution) {
    /*
      Returns the unbounded fee growths for a pool given
      the current state `pool-state` and the previous state `pool-state-prev`
      where the pool-states are maps as those passed to `backtest-position`
    */

    let feeUnbounded0 = poolDilution * (poolState['fee-growth-global0'] - prevPoolState['fee-growth-global0']);
    let feeUnbounded1 = poolDilution * (poolState['fee-growth-global1'] - prevPoolState['fee-growth-global1']);
    return [feeUnbounded0, feeUnbounded1];
}

function withinRange(limitLower, limitUpper, lowPrice, highPrice) {
    return highPrice > limitLower && lowPrice < limitUpper;
}

function activeRatio(limitLower, limitUpper, lowPrice, highPrice) {
    if (highPrice == lowPrice) {
        if (withinRange(limitLower, limitUpper, lowPrice, highPrice)) {
            return 1.0;
        }
        else{
            return 0.0;
        }
    }
    else{
        let priceRange = highPrice - lowPrice;
        let ratio = (Math.min(highPrice, limitUpper) - Math.max(lowPrice, limitLower)) / priceRange; // ! check u
        if (!withinRange(limitLower, limitUpper, lowPrice, highPrice) || isNaN(ratio)) {
            return 0.0;
        }
        else{
            return ratio;
        }
    }
}

function proportionalFees(feeUnbounded0, feeUnbounded1, liquidity, activePortion) {
    let fees0 = (feeUnbounded0*liquidity*activePortion) / Math.pow(2, 128);
    let fees1 = (feeUnbounded1*liquidity*activePortion) / Math.pow(2, 128);
    return [fees0, fees1];
}

function periodFees(poolTicks, poolStateCurrent, poolStatePrev, liquidity, priceLower, priceUpper, lowPrice, highPrice, diluteFees) {
    let poolDilution = diluteFees ? dilutionFactor(poolTicks, poolStatePrev, liquidity) : 1.0; 
    let [feeUnbounded0, feeUnbounded1] = unboundedFees(poolStateCurrent, poolStatePrev, poolDilution);
    let activePortion = activeRatio(priceLower, priceUpper, lowPrice, highPrice);
    return proportionalFees(feeUnbounded0, feeUnbounded1, liquidity, activePortion);
}

function eth2Dec(n, u) {
  let units = 10**u;
  return n / units;
}

function getPeriodPrice0(poolState, referencePrice) {
  switch (referencePrice) {
    case 'hodl':
      return poolState["token0-price-usd"];
    case 'token0':
      return 1;
    case 'token1':
      return poolState["token1-price"];
    default:
      return null;
  }
}

function getPeriodPrice1(poolState, referencePrice) {
  switch (referencePrice) {
    case 'hodl':
      return poolState["token1-price-usd"];
    case 'token0':
      return poolState["token0-price"];
    case 'token1':
      return 1;
    default:
      return null;
  }
}

function seconds2Days(seconds){
    return seconds/(60*60*24);
}

function datetime2Ts(dt){
    // dt is a date object
    return dt.getTime() / 1000;
}

function computeApr(poolState, pnl, refValue, firstTs) {
  let daysNum = seconds2Days(datetime2Ts(poolState.timestamp) - datetime2Ts(firstTs));
  let yearPortion = Number(daysNum) / 365;
  let multiplier = 1/yearPortion;
  if (0 == refValue){
    return 0;
  } else {
    return ((pnl/refValue)*multiplier) * 100.0;
  }
}

function computePnl(currentValue, refValue) {
  if (0 == refValue) {
    return 0;
  } else {
    return currentValue-refValue;
  }
}

function positionActive(poolState, tickLower, tickUpper) {
    return poolState.tick >= tickLower && poolState.tick <= tickUpper;
}

function backtesterPosition(historic_states, tick_lower, tick_upper, liquidity, first_ts, reference_price, dilute_fees = false, pool_ticks=[]) {
    let res = [];
    while (historic_states.length > 1) {
        let pool_state_prev = historic_states[0];
        let pool_state_current = historic_states[1];
        let pool = makePoolFromState(pool_state_current);
        let position = makePosition(pool, tick_lower, tick_upper, liquidity);
        let liquidity_bn = ebn2bn(`${position.liquidity}`, 0);

        let amount0 = positionAmount0(position);
        let amount1 = positionAmount1(position);
        let high = pool_state_current["high"];
        let low = pool_state_current["low"];
        let token0_decimals = pool_state_current["token0-decimals"];
        let token1_decimals = pool_state_current["token1-decimals"];

        let init_amount0 = 0, init_amount1 = 0,
            init_price0  = 0, init_price1  = 0;

        if (res && res[0]) {
            init_amount0 = res[0].amount0 !== undefined ? res[0].amount0 : 0;
            init_amount1 = res[0].amount1 !== undefined ? res[0].amount1 : 0;
            init_price0  = res[0].price0  !== undefined ? res[0].price0 : 0;
            init_price1  = res[0].price1  !== undefined ? res[0].price1 : 0;
        }

        let [price_lower, price_upper] = periodPrices(pool_state_current, tick_upper, tick_lower);
        let [fees0, fees1] = periodFees(pool_ticks, pool_state_current, pool_state_prev, liquidity_bn, price_lower, price_upper,
                                                                                                    low, high, dilute_fees);
        // fees0 and fees1  are NaN
        let current_fees0 = eth2Dec(fees0, token0_decimals);
        let current_fees1 = eth2Dec(fees1, token1_decimals);

        let prev_accum_fees0 = res[res.length - 1] !== undefined ? res[res.length - 1]["accum-fees0"] : false;
        let prev_accum_fees1 = res[res.length - 1] !== undefined ? res[res.length - 1]["accum-fees1"] : false;
        
        let accum_fees0 = (prev_accum_fees0 ? prev_accum_fees0 : 0) + current_fees0;
        let accum_fees1 = (prev_accum_fees1 ? prev_accum_fees1 : 0) + current_fees1;

        let current_total0 = amount0 + accum_fees0;
        let current_total1 = amount1 + accum_fees1;
        let period_price0 = getPeriodPrice0(pool_state_current, reference_price);
        let period_price1 = getPeriodPrice1(pool_state_current, reference_price);

        let value0 = (reference_price === 'hodl') ? (init_amount0*period_price0) : (init_amount0*init_price0);
        let value1 = (reference_price === 'hodl') ? (init_amount1*period_price1) : (init_amount1*init_price1);

        let ref_value = value0 + value1;

        let current_value = (amount1*period_price1)+(amount0*period_price0);
        let current_value_with_fees = (current_total1*period_price1)+(current_total0*period_price0);

        let pnl = computePnl(current_value_with_fees, ref_value);
        let apr = computeApr(pool_state_current, pnl, ref_value, first_ts);

        let il = current_value - ref_value;
        let is_active = positionActive(pool_state_prev, tick_lower, tick_upper);

        res.push({
            timestamp: pool_state_current.timestamp,
            date: pool_state_current.date,
            amount0: amount0,
            amount1: amount1,
            price0: period_price0,
            price1: period_price1,
            liquidity: liquidity_bn,
            il: il,
            pnl: pnl,
            apr: apr,
            positionActive: is_active,
            accumFees0: accum_fees0,
            accumFees1: accum_fees1,
            fees0: current_fees0,
            fees1: current_fees1
        });
        // This is equivalent to the 'recur' in Clojure
        historic_states = historic_states.slice(1);
    }
    return res;
}

module.exports = {backtesterPosition};
