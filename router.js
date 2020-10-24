// Router

const ROUND_DOWN = 1;

class Router {

  init() {
  }

  can_update(data) {
    return blockchain.requireAuth(blockchain.contractOwner(), "active") && !this.isLocked();
  }

  _requireOwner() {
    if(!blockchain.requireAuth(blockchain.contractOwner(), 'active')){
      throw 'require auth error:not contractOwner';
    }
  }

  isLocked() {
    const now = Math.floor(tx.time / 1e9);
    const status = +storage.get("timeLockStatus") || 0;
    const until = +storage.get("timeLockUntil") || 0;
    return status == 0 && now > until;
  }

  startTimeLock() {
    this._requireOwner();

    storage.put("timeLockStatus", "1");
  }

  stopTimeLock() {
    this._requireOwner();

    const now = Math.floor(tx.time / 1e9);

    storage.put("timeLockUntil", (now + TIME_LOCK_DURATION).toString());
    storage.put("timeLockStatus", "0")
  }

  setSwap(swap) {
    if (!blockchain.requireAuth(blockchain.contractOwner(), "active")) {
      throw "only owner can change";
    }

    storage.put("swap", swap);
  }

  _getSwap() {
    return storage.get("swap") || '';
  }

  _quote(amountADesired, reserveA, reserveB) {
    amountADesired = new BigNumber(amountADesired);
    reserveA = new BigNumber(reserveA);
    reserveB = new BigNumber(reserveB);

    if (amountADesired.lt(0) || reserveA.lte(0) || reserveB.lt(0)) {
      throw "Xigua: INVALID_INPUT";
    }

    return amountADesired.times(reserveB).div(reserveA);
  }

  _addLiquidity(
      tokenA,
      tokenB,
      amountADesired,
      amountBDesired,
      amountAMin,
      amountBMin
  ) {
    const pair = JSON.parse(blockchain.call(this._getSwap(), "getPair", [tokenA, tokenB])[0]);

    if (!pair) {
      throw "no pair";
    }

    let reserveA;
    let reserveB; 
    if (tokenA == pair.token0) {
      reserveA = new BigNumber(pair.reserve0);
      reserveB = new BigNumber(pair.reserve1);
    } else {
      reserveA = new BigNumber(pair.reserve1);
      reserveB = new BigNumber(pair.reserve0);
    }

    if (reserveA.eq(0) && reserveB.eq(0)) {
      return [amountADesired, amountBDesired];
    } else {
      const amountBOptimal = this._quote(amountADesired, reserveA, reserveB);
      if (amountBOptimal.lte(amountBDesired)) {
        if (amountBOptimal.lt(amountBMin)) {
          throw "insufficient b amount";
        }

        return [amountADesired, amountBOptimal];
      } else {
        const amountAOptimal = this._quote(amountBDesired, reserveB, reserveA);

        if (amountAOptimal.gt(amountADesired)) {
          throw "something went wrong";
        }

        if (amountAOptimal.lt(amountAMin)) {
          throw "insufficient a amount";
        }

        return [amountAOptimal, amountBDesired];
      }
    }
  }

  addLiquidity(
      tokenA,
      tokenB,
      amountADesired,
      amountBDesired,
      amountAMin,
      amountBMin,
      toAddress
  ) {
    const pair = JSON.parse(blockchain.call(this._getSwap(), "getPair", [tokenA, tokenB])[0]);

    if (!pair) {
      throw "Xigua: no pair";
    }

    const precisionA = tokenA == pair.token0 ? pair.precision0 : pair.precision1;
    const precisionB = tokenA == pair.token0 ? pair.precision1 : pair.precision0;

    amountADesired = new BigNumber(new BigNumber(amountADesired).toFixed(precisionA, ROUND_DOWN));
    amountBDesired = new BigNumber(new BigNumber(amountBDesired).toFixed(precisionB, ROUND_DOWN));
    amountAMin = new BigNumber(new BigNumber(amountAMin).toFixed(precisionA, ROUND_DOWN));
    amountBMin = new BigNumber(new BigNumber(amountBMin).toFixed(precisionB, ROUND_DOWN));

    if (amountADesired.lte(0) || amountBDesired.lte(0) || amountAMin.lte(0) || amountBMin.lte(0)) {
      throw "Xigua: INVALID_INPUT";
    }

    const amountArray = this._addLiquidity(
        tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin);
    const amountA = amountArray[0];
    const amountB = amountArray[1];
    const liquidity = blockchain.call(
        this._getSwap(),
        "mint",
        [tokenA, tokenB, amountA.toFixed(precisionA, ROUND_DOWN), amountB.toFixed(precisionB, ROUND_DOWN), toAddress])[0];

    return [amountA.toFixed(precisionA, ROUND_DOWN), amountB.toFixed(precisionB, ROUND_DOWN), liquidity];
  }

  createPairAndAddLiquidity(
      tokenA,
      tokenB,
      amountADesired,
      amountBDesired,
      toAddress
  ) {
    blockchain.call(this._getSwap(), "createPair", [tokenA, tokenB]);
    if (new BigNumber(amountADesired).gt(0) && new BigNumber(amountBDesired).gt(0)) {
      return this.addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountADesired, amountBDesired, toAddress);
    } else {
      return [0, 0, 0];
    }
  }

  removeLiquidity(
      tokenA,
      tokenB,
      liquidity,
      amountAMin,
      amountBMin,
      toAddress
  ) {
    const pair = JSON.parse(blockchain.call(this._getSwap(), "getPair", [tokenA, tokenB])[0]);
    
    if (!pair) {
      throw "Xigua: no pair";
    }

    const precisionA = tokenA == pair.token0 ? pair.precision0 : pair.precision1;
    const precisionB = tokenA == pair.token0 ? pair.precision1 : pair.precision0;

    liquidity = new BigNumber(liquidity);
    amountAMin = new BigNumber(amountAMin);
    amountBMin = new BigNumber(amountBMin);

    if (liquidity.lte(0) || amountAMin.lte(0) || amountBMin.lte(0)) {
      throw "Xigua: INVALID_INPUT";
    }

    const amountArray = JSON.parse(blockchain.call(
        this._getSwap(), "burn", [tokenA, tokenB, liquidity.toString(), toAddress])[0]);
    const amountA = new BigNumber(amountArray[0]);
    const amountB = new BigNumber(amountArray[1]);

    if (amountA.lt(amountAMin)) {
      throw "Xigua: INSUFFICIENT_A_AMOUNT";
    }

    if (amountB.lt(amountBMin)) {
      throw "Xigua: INSUFFICIENT_B_AMOUNT";
    }

    return [amountA.toFixed(precisionA, ROUND_DOWN), amountB.toFixed(precisionB, ROUND_DOWN)];
  }

  _swap(amounts, path, toAddress) {
    path = JSON.parse(path);
    for (let i = 0; i < path.length - 1; i++) {
      const srcAddress = i == 0 ? JSON.parse(blockchain.contextInfo()).caller.name : this._getSwap();
      const dstAddress = i == path.length - 2 ? toAddress : this._getSwap();
      blockchain.call(this._getSwap(), "swap",
          [path[i], path[i + 1], amounts[i].toString(), "0", "0", amounts[i + 1].toString(), srcAddress, dstAddress]);
    }
  }

  swapExactTokensForTokens(
      amountIn,
      amountOutMin,
      path,
      toAddress
  ) {
    const amounts = this.getAmountsOut(amountIn, path);

    if (new BigNumber(amounts[amounts.length - 1]).lt(amountOutMin)) {
      throw 'Xigua: INSUFFICIENT_OUTPUT_AMOUNT';
    }

    this._swap(amounts, path, toAddress);
    return amounts;
  }

  swapTokensForExactTokens(
      amountOut,
      amountInMax,
      path,
      toAddress
  ) {
    const amounts = this.getAmountsIn(amountOut, path);

    if (new BigNumber(amounts[0]).gt(amountInMax)) {
      throw 'Xigua: EXCESSIVE_INPUT_AMOUNT' + amounts[0] + ',' + amountInMax;
    }

    this._swap(amounts, path, toAddress);
    return amounts;
  }

  // given an input amount of an asset and pair reserves, returns the maximum output amount of the other asset
  getAmountOut(amountIn, reserveIn, reserveOut, precision) {
    amountIn = new BigNumber(amountIn);
    reserveIn = new BigNumber(reserveIn);
    reserveOut = new BigNumber(reserveOut);

    if (amountIn.lte(0)) {
      throw 'Xigua: INSUFFICIENT_INPUT_AMOUNT';
    }

    if (reserveIn.lte(0) || reserveOut.lte(0)) {
      throw 'Xigua: INSUFFICIENT_LIQUIDITY';
    }

    precision = precision * 1 || 0;
    if (precision < 0) {
      throw 'Xigua: INVALID_PRECISION';
    }

    const amountInWithFee = amountIn.times(997);
    const numerator = amountInWithFee.times(reserveOut);
    const denominator = reserveIn.times(1000).plus(amountInWithFee);
    return numerator.div(denominator).toFixed(precision, ROUND_DOWN);
  }

  // given an output amount of an asset and pair reserves, returns a required input amount of the other asset
  getAmountIn(amountOut, reserveIn, reserveOut, precision) {
    amountOut = new BigNumber(amountOut);
    reserveIn = new BigNumber(reserveIn);
    reserveOut = new BigNumber(reserveOut);

    if (amountOut.lte(0)) {
      throw 'Xigua: INSUFFICIENT_OUTPUT_AMOUNT';
    }

    if (reserveIn.lte(0) || reserveOut.lt(amountOut)) {
      throw 'Xigua: INSUFFICIENT_LIQUIDITY';
    }

    precision = precision * 1 || 0;
    if (precision < 0) {
      throw 'Xigua: INVALID_PRECISION';
    }

    const numerator = reserveIn.times(amountOut).times(1000);
    const denominator = reserveOut.minus(amountOut).times(997);
    return numerator.div(denominator).plus(1 / 10 ** precision).toFixed(precision, ROUND_DOWN);
  }

  // performs chained getAmountOut calculations on any number of pairs
  getAmountsOut(amountIn, path) {
    path = JSON.parse(path);

    if (path.length < 2) {
      throw 'Xigua: INVALID_PATH';
    }

    const amounts = [amountIn];
    for (let i = 0; i < path.length - 1; i++) {
      const pair = JSON.parse(blockchain.call(this._getSwap(), "getPair", [path[i], path[i + 1]])[0]);

      if (!pair) {
        throw "Xigua: no pair";
      }

      if (pair.token0 == path[i]) {
        amounts.push(this.getAmountOut(amounts[i], pair.reserve0, pair.reserve1, pair.precision1));
      } else {
        amounts.push(this.getAmountOut(amounts[i], pair.reserve1, pair.reserve0, pair.precision0));
      }
    }

    return amounts;
  }

  // performs chained getAmountIn calculations on any number of pairs
  getAmountsIn(amountOut, path) {
    path = JSON.parse(path);

    if (path.length < 2) {
      throw 'Xigua: INVALID_PATH';
    }

    const amounts = [amountOut];
    for (let i = path.length - 1; i > 0; i--) {
      const pair = JSON.parse(blockchain.call(this._getSwap(), "getPair", [path[i - 1], path[i]])[0]);

      if (!pair) {
        throw "Xigua: no pair";
      }

      if (pair.token0 == path[i - 1]) {
        amounts.push(this.getAmountIn(amounts[path.length - 1 - i], pair.reserve0, pair.reserve1, pair.precision0));
      } else {
        amounts.push(this.getAmountIn(amounts[path.length - 1 - i], pair.reserve1, pair.reserve0, pair.precision1));
      }
    }

    amounts.reverse();

    return amounts;
  }

  hasPath(path) {
    path = JSON.parse(path);

    if (path.length < 2) {
      return 0;
    }

    for (let i = 0; i < path.length - 1; i++) {
      const pair = JSON.parse(blockchain.call(this._getSwap(), "getPair", [path[i], path[i + 1]])[0]);

      if (!pair) {
        return 0;
      }
    }

    return 1;
  }
}

module.exports = Router;
