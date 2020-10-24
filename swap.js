// Swap

/*

# feeTo
# listingFee

# pair
pairName => {
  createdTime: now,
  token0: token0,
  token1: token1,
  precision0: 0,
  precision1: 0,
  reserve0: "0",
  reserve1: "0",
  blockTimestampLast: 0,
  price0CumulativeLast: "0",
  price1CumulativeLast: "0",
  kLast: "0",
  xlp: xlpSymbol
  xlpSupply: "0"
}

# allPairs
chunkIndex => [pairName]  // Up to CHUNK_SIZE

# tokenBalance
tokenName => "0"

*/

const CHUNK_SIZE = 500;
const UNIVERSAL_PRECISION = 8;
const MINIMUM_LIQUIDITY = 0.00001;
const UNIT_LIQUIDITY = 0.00000001;

const ROUND_DOWN = 1;

const TIME_LOCK_DURATION = 12 * 3600; // 12 hours

class Swap {

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

  setFeeTo(feeTo) {
    this._requireOwner();

    storage.put("feeTo", feeTo);
  }

  _getFeeTo() {
    return storage.get("feeTo") || '';
  }

  setListingFee(fee) {
    this._requireOwner();

    storage.put("listingFee", fee.toString());
  }

  _getListingFee() {
    return storage.get("listingFee");
  }

  _setPair(pairName, pair) {
    storage.mapPut("pair", pairName, JSON.stringify(pair));
  }

  _setPairObj(pair) {
    const pairName = pair.token0 + "/" + pair.token1;
    this._setPair(pairName, pair);
  }

  _getPair(pairName) {
    return JSON.parse(storage.mapGet("pair", pairName) || "null");
  }

  _hasPair(pairName) {
    return storage.mapHas("pair", pairName);
  }

  _insertToAllPairs(pairName) {
    let index = 0;
    while (storage.mapHas("allPairs", index.toString())) {
      ++index;
    }

    if (index - 1 >= 0) {
      const array = JSON.parse(storage.mapGet("allPairs", (index - 1).toString()));
      if (array.length < CHUNK_SIZE) {
        array.push(pairName);
        storage.mapPut("allPairs", (index - 1).toString(), JSON.stringify(array));
        return;
      }
    }

    storage.mapPut("allPairs", index.toString(), JSON.stringify([pairName]));
  }

  _getPairName(token0, token1) {
    if (token0 < token1) {
      return token0 + "/" + token1;
    } else {
      return token1 + "/" + token0;
    }
  }

  getPair(token0, token1) {
    const pairName = this._getPairName(token0, token1);
    return this._getPair(pairName);
  }

  _plusTokenBalance(token, delta, precision) {
    var balance = new BigNumber(storage.mapGet("tokenBalance", token) || "0");
    balance = balance.plus(delta);
    storage.mapPut("tokenBalance", token, balance.toFixed(precision, ROUND_DOWN));
  }

  _minusTokenBalance(token, delta, precision) {
    var balance = new BigNumber(storage.mapGet("tokenBalance", token) || "0");
    balance = balance.minus(delta);
    storage.mapPut("tokenBalance", token, balance.toFixed(precision, ROUND_DOWN));
  }

  _setTokenBalance(token, balance, precision) {
    storage.mapPut("tokenBalance", token, balance.toFixed(precision, ROUND_DOWN));
  }

  _getTokenBalance(token) {
    return new BigNumber(storage.mapGet("tokenBalance", token));
  }

  allPairs() {
    let index = 0;
    let res = [];
    while (storage.mapHas("allPairs", index.toString())) {
      res = res.concat(JSON.parse(storage.mapGet("allPairs", index.toString())));
      ++index;
    }
    return res;
  }

  createPair(token0, token1) {
    if (token0 > token1) {
      let temp = token0;
      token0 = token1;
      token1 = temp;
    }

    const pairName = this._getPairName(token0, token1);

    if (this._hasPair(pairName)) {
      throw "pair exists";
    }

    const totalSupply0 = +blockchain.call("token.iost", "totalSupply", [token0])[0];
    const totalSupply1 = +blockchain.call("token.iost", "totalSupply", [token1])[0];
    if (!totalSupply0 || !totalSupply1) {
      throw "invalid token";
    }

    const now = Math.floor(tx.time / 1e9);

    if (this._getFeeTo()) {
      blockchain.transfer(tx.publisher,
                          this._getFeeTo(),
                          this._getListingFee(),
                          "listing fee");
    }

    const xlpSymbol = "xlp" + tx.time.toString().substring(0, 13);

    storage.mapPut("pair", pairName, JSON.stringify({
      createdTime: now,
      token0: token0,
      token1: token1,
      precision0: this._checkPrecision(token0),
      precision1: this._checkPrecision(token1),
      reserve0: "0",
      reserve1: "0",
      blockTimestampLast: 0,
      price0CumulativeLast: "0",
      price1CumulativeLast: "0",
      kLast: "0",
      xlp: xlpSymbol,
      xlpSupply: "0"
    }));

    this._insertToAllPairs(pairName);

    // Create XLP Token.

    const config = {
      "decimal": UNIVERSAL_PRECISION,
      "canTransfer": true,
      "fullName": "Xigua LP Token: " + token0 + " / " + token1
    };

    blockchain.callWithAuth("token.iost", "create",
        [xlpSymbol, blockchain.contractName(), 10000000000, config]);
  }

  // update reserves and, on the first call per block, price accumulators
  _update(pair, balance0, balance1) {
    const now = Math.floor(tx.time / 1e9);

    if (now < pair.blockTimestampLast) {
      throw "block time error";
    }

    const timeElapsed = now - pair.blockTimestampLast;

    if (timeElapsed > 0 && pair.reserve0 > 0 && pair.reserve1 > 0) {
      pair.price0CumulativeLast =
          new BigNumber(pair.price0CumulativeLast).plus(
              new BigNumber(pair.reserve1).div(
                  pair.reserve0).times(timeElapsed)).toFixed(UNIVERSAL_PRECISION, ROUND_DOWN);
      pair.price1CumulativeLast =
          new BigNumber(pair.price1CumulativeLast).plus(
              new BigNumber(pair.reserve0).div(
                  pair.reserve1).times(timeElapsed)).toFixed(UNIVERSAL_PRECISION, ROUND_DOWN);
    }

    pair.reserve0 = balance0.toFixed(pair.precision0, ROUND_DOWN);
    pair.reserve1 = balance1.toFixed(pair.precision1, ROUND_DOWN);
    pair.blockTimestampLast = now;

    blockchain.receipt(JSON.stringify(["sync", pair.reserve0, pair.reserve1]));
  }

  // if fee is on, mint liquidity equivalent to 1/6th of the growth in sqrt(k)
  _mintFee(pair) {
    const feeTo = this._getFeeTo();
    const feeOn = feeTo != '';

    const _kLast = new BigNumber(pair.kLast); // gas savings

    if (feeOn) {
      if (!_kLast.eq(0)) {
        const rootK = (new BigNumber(pair.reserve0).times(pair.reserve1)).sqrt();
        const rootKLast = _kLast.sqrt();

        if (rootK.gt(rootKLast)) {
          const totalSupply = new BigNumber(blockchain.call("token.iost", "supply", [pair.xlp])[0]);

          const numerator = rootK.minus(rootKLast).times(totalSupply);
          const denominator = rootK.times(5).plus(rootKLast);
          const liquidity = numerator.div(denominator);
          if (liquidity.gt(0)) {
            this._mint(pair.xlp, feeTo, liquidity);
          }
        }
      }
    } else if (!_kLast.eq(0)) {
      pair.kLast = "0";
    }

    return feeOn;
  }

  _mint(xlpSymbol, toAddress, amount) {
    blockchain.callWithAuth("token.iost", "issue",
        [xlpSymbol, toAddress, amount.toFixed(UNIVERSAL_PRECISION, ROUND_DOWN)]);
  }

  _burn(xlpSymbol, fromAddress, amount) {
    blockchain.callWithAuth("token.iost", "destroy",
        [xlpSymbol, fromAddress, amount.toFixed(UNIVERSAL_PRECISION, ROUND_DOWN)]);
  }

  _checkPrecision(symbol) {
    return +storage.globalMapGet("token.iost", "TI" + symbol, "decimal") || 0;
  }

  mint(tokenA, tokenB, amountA, amountB, toAddress) {
    const pair = this.getPair(tokenA, tokenB);

    if (!pair) {
      throw "Xigua: no pair";
    }

    const amount0 = new BigNumber(pair.token0 == tokenA ? amountA : amountB);
    const amount1 = new BigNumber(pair.token1 == tokenB ? amountB : amountA);

    if (amount0.lte(0) || amount1.lte(0)) {
      throw "Xigua: INVALID_INPUT";
    }

    blockchain.callWithAuth("token.iost", "transfer",
        [pair.token0,
         tx.publisher,
         blockchain.contractName(),
         amount0.toFixed(pair.precision0, ROUND_DOWN),
         "mint xlp"]);
    this._plusTokenBalance(pair.token0, amount0, pair.precision0);

    blockchain.callWithAuth("token.iost", "transfer",
        [pair.token1,
         tx.publisher,
         blockchain.contractName(),
         amount1.toFixed(pair.precision1, ROUND_DOWN),
         "mint xlp"]);
    this._plusTokenBalance(pair.token1, amount1, pair.precision1);

    const feeOn = this._mintFee(pair);

    // gas savings, must be defined here since totalSupply can update in _mintFee
    const _totalSupply = new BigNumber(blockchain.call("token.iost", "supply", [pair.xlp])[0]);

    let liquidity;

    if (_totalSupply.eq(0)) {
      liquidity = amount0.times(amount1).sqrt().minus(MINIMUM_LIQUIDITY);
      this._mint(pair.xlp, blockchain.contractName(), MINIMUM_LIQUIDITY); // permanently lock the first MINIMUM_LIQUIDITY tokens
    } else {
      liquidity = BigNumber.min(amount0.times(_totalSupply).div(pair.reserve0),
          amount1.times(_totalSupply).div(pair.reserve1));
    }

    const balance0 = amount0.plus(pair.reserve0);
    const balance1 = amount1.plus(pair.reserve1);

    if (liquidity.lt(UNIT_LIQUIDITY)) {
      throw 'Xigua: INSUFFICIENT_LIQUIDITY_MINTED';
    }

    this._mint(pair.xlp, toAddress, liquidity);

    this._update(pair, balance0, balance1);

    if (feeOn) {
      pair.kLast = new BigNumber(pair.reserve0).times(pair.reserve1).toFixed(
          pair.precision0 + pair.precision1, ROUND_DOWN); // reserve0 and reserve1 are up-to-date
    }

    pair.xlpSupply = blockchain.call("token.iost", "supply", [pair.xlp])[0];
    this._setPairObj(pair);

    return liquidity;
  }

  burn(tokenA, tokenB, liquidity, toAddress) {
    liquidity = new BigNumber(liquidity);

    if (liquidity.lt(UNIT_LIQUIDITY)) {
      throw "Xigua: INVALID_INPUT";
    }

    const pair = this.getPair(tokenA, tokenB);

    if (!pair) {
      throw "Xigua: no pair";
    }

    const feeOn = this._mintFee(pair);

    // gas savings, must be defined here since totalSupply can update in _mintFee
    const _totalSupply = blockchain.call("token.iost", "supply", [pair.xlp])[0];

    const amount0 = liquidity.times(pair.reserve0).div(_totalSupply); // using balances ensures pro-rata distribution
    const amount1 = liquidity.times(pair.reserve1).div(_totalSupply); // using balances ensures pro-rata distribution

    if (amount0.lte(0) || amount1.lte(0)) {
      throw 'Xigua: INSUFFICIENT_LIQUIDITY_BURNED';
    }

    this._burn(pair.xlp, tx.publisher, liquidity);

    blockchain.callWithAuth("token.iost", "transfer",
        [pair.token0,
         blockchain.contractName(),
         toAddress,
         amount0.toFixed(pair.precision0, ROUND_DOWN),
         "burn xlp"]);
    this._minusTokenBalance(pair.token0, amount0, pair.precision0);

    blockchain.callWithAuth("token.iost", "transfer",
        [pair.token1,
         blockchain.contractName(),
         toAddress,
         amount1.toFixed(pair.precision1, ROUND_DOWN),
         "burn xlp"]);
    this._minusTokenBalance(pair.token1, amount1, pair.precision1);

    const balance0 = new BigNumber(pair.reserve0).minus(amount0);
    const balance1 = new BigNumber(pair.reserve1).minus(amount1);

    this._update(pair, balance0, balance1);

    if (feeOn) {
      pair.kLast = new BigNumber(pair.reserve0).times(pair.reserve1).toFixed(
          pair.precision0 + pair.precision1, ROUND_DOWN); // reserve0 and reserve1 are up-to-date
    }

    pair.xlpSupply = blockchain.call("token.iost", "supply", [pair.xlp])[0];
    this._setPairObj(pair);

    if (tokenA == pair.token0) {
      return [amount0.toFixed(pair.precision0, ROUND_DOWN), amount1.toFixed(pair.precision1, ROUND_DOWN)];
    } else {
      return [amount1.toFixed(pair.precision1, ROUND_DOWN), amount0.toFixed(pair.precision0, ROUND_DOWN)];
    }
  }

  swap(tokenA, tokenB, amountAIn, amountBIn, amountAOut, amountBOut, srcAddress, dstAddress) {
    const pair = this.getPair(tokenA, tokenB);

    if (!pair) {
      throw "Xigua: no pair";
    }

    const amount0In = new BigNumber(pair.token0 == tokenA ? amountAIn : amountBIn);
    const amount1In = new BigNumber(pair.token1 == tokenB ? amountBIn : amountAIn);
    const amount0Out = new BigNumber(pair.token0 == tokenA ? amountAOut : amountBOut);
    const amount1Out = new BigNumber(pair.token1 == tokenB ? amountBOut : amountAOut);

    if (amount0In.lt(0) || amount1In.lt(0) || amount0Out.lt(0) || amount1Out.lt(0)) {
      throw "Xigua: INVALID_INPUT";
    }

    if (amount0Out.eq(0) && amount1Out.eq(0)) {
      throw "Xigua: INSUFFICIENT_OUTPUT_AMOUNT";
    }

    if (amount0In.eq(0) && amount1In.eq(0)) {
      throw "Xigua: INSUFFICIENT_INPUT_AMOUNT";
    }

    if (amount0Out.gte(pair.reserve0) || amount1Out.gte(pair.reserve1)) {
      throw "Xigua: INSUFFICIENT_LIQUIDITY";
    }

    if (amount0In.gt(0) && srcAddress != blockchain.contractName()) {
      // optimistically transfer tokens
      blockchain.callWithAuth("token.iost", "transfer",
          [pair.token0,
           srcAddress,
           blockchain.contractName(),
           amount0In.toFixed(pair.precision0, ROUND_DOWN),
           "swap in"]);
      this._plusTokenBalance(pair.token0, amount0In, pair.precision0);
    }

    if (amount1In.gt(0) && srcAddress != blockchain.contractName()) {
      // optimistically transfer tokens
      blockchain.callWithAuth("token.iost", "transfer",
          [pair.token1,
           srcAddress,
           blockchain.contractName(),
           amount1In.toFixed(pair.precision1, ROUND_DOWN),
           "swap in"]);
      this._plusTokenBalance(pair.token1, amount1In, pair.precision1);
    }

    if (amount0Out.gt(0) && dstAddress != blockchain.contractName()) {
      // optimistically transfer tokens
      blockchain.callWithAuth("token.iost", "transfer",
          [pair.token0,
           blockchain.contractName(),
           dstAddress,
           amount0Out.toFixed(pair.precision0, ROUND_DOWN),
           "swap out"]);
      this._minusTokenBalance(pair.token0, amount0Out, pair.precision0);
    }

    if (amount1Out.gt(0) && dstAddress != blockchain.contractName()) {
      // optimistically transfer tokens
      blockchain.callWithAuth("token.iost", "transfer",
          [pair.token1,
           blockchain.contractName(),
           dstAddress,
           amount1Out.toFixed(pair.precision1, ROUND_DOWN),
           "swap out"]);
      this._minusTokenBalance(pair.token1, amount1Out, pair.precision1);
    }

    const balance0 = new BigNumber(pair.reserve0).plus(amount0In).minus(amount0Out);
    const balance1 = new BigNumber(pair.reserve1).plus(amount1In).minus(amount1Out);

    const balance0Adjusted = balance0.times(1000).minus(amount0In.times(3));
    const balance1Adjusted = balance1.times(1000).minus(amount1In.times(3));

    if (balance0Adjusted.times(balance1Adjusted).lt(new BigNumber(pair.reserve0).times(pair.reserve1).times(1000000))) {
      throw "Xigua: K" + balance0Adjusted + ", " + balance1Adjusted + ", " + pair.reserve0 + ", " + pair.reserve1;
    }

    this._update(pair, balance0, balance1);
    this._setPairObj(pair);
  }

  // force all token balances to match reserves
  skimAll() {
    const allPairs = this.allPairs();
    const map = {};

    allPairs.forEach(pairName => {
      const pair = this._getPair(pairName);
      map[pair.token0] = map[pair.token0] ? map[pair.token0].plus(pair.reserve0) : new BigNumber(pair.reserve0);
      map[pair.token1] = map[pair.token1] ? map[pair.token1].plus(pair.reserve1) : new BigNumber(pair.reserve1);
    });

    for (let token in map) {
      const precision = this._checkPrecision(token);
      this._setTokenBalance(token, map[token], precision);
      const realBalance = new BigNumber(blockchain.call("token.iost", "balanceOf", [token, blockchain.contractName()])[0]);
      if (realBalance.gt(map[token])) {
        const precision = this._checkPrecision(token);

        blockchain.callWithAuth("token.iost", "transfer",
            [token,
             blockchain.contractName(),
             this._getFeeTo() || tx.publisher,
             realBalance.minus(map[token]).toFixed(precision, ROUND_DOWN),
             "skim all"]);
      }
    }
  }

  // force one token balance to match reserves
  skim(token) {
    const balance = this._getTokenBalance(token);
    const realBalance = new BigNumber(blockchain.call("token.iost", "balanceOf", [token, blockchain.contractName()])[0]);

    if (realBalance.gt(balance)) {
      const precision = this._checkPrecision(token);

      blockchain.callWithAuth("token.iost", "transfer",
          [token,
           blockchain.contractName(),
           this._getFeeTo() || tx.publisher,
           realBalance.minus(balance).toFixed(precision, ROUND_DOWN),
           "skim"]);
    }
  }
}

module.exports = Swap;
