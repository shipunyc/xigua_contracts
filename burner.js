// Burner

const TIME_LOCK_DURATION = 12 * 3600; // 12 hours
const IOST_PRECISION = 8;
const VOST_PRECISION = 8;
const XG_PRECISION = 6;
const XUSD_PRECISION = 6;
const ROUND_DOWN = 1;

class Burner {

  init() {
  }

  can_update(data) {
    return blockchain.requireAuth(blockchain.contractOwner(), 'active') && !this.isLocked();
  }

  _requireOwner() {
    if(!blockchain.requireAuth(blockchain.contractOwner(), 'active')){
      throw 'require auth error:not contractOwner';
    }
  }

  isLocked() {
    const now = Math.floor(tx.time / 1e9);
    const status = +storage.get('timeLockStatus') || 0;
    const until = +storage.get('timeLockUntil') || 0;
    return status == 1 || now < until;
  }

  startTimeLock() {
    this._requireOwner();

    storage.put('timeLockStatus', '1');
  }

  stopTimeLock() {
    this._requireOwner();

    const now = Math.floor(tx.time / 1e9);

    storage.put('timeLockUntil', (now + TIME_LOCK_DURATION).toString());
    storage.put('timeLockStatus', '0')
  }

  setRouter(router) {
    this._requireOwner();

    storage.put('router', router);
  }

  _getRouter() {
    return storage.get('router') || '';
  }

  setSwap(swap) {
    this._requireOwner();

    storage.put('swap', swap);
  }

  _getSwap() {
    return storage.get('swap') || '';
  }

  _setNextLottery(nextLottery) {
    storage.put('nextLottery', nextLottery.toString());
  }
    
  getNextLottery() {
    return +storage.get('nextLottery') || 0;
  }

  _setLotteryQueue(queue) {
    storage.put('lotteryQueue', JSON.stringify(queue));
  }

  _getLotteryQueue() {
    return JSON.parse(storage.get('lotteryQueue') || '[]');
  }

  _checkPrecision(symbol) {
    return +storage.globalMapGet("token.iost", "TI" + symbol, "decimal") || 0;
  }

  _swapAToBWithPath(path) {
    const amountInStr = blockchain.call(
        'token.iost',
        'balanceOf',
        [path[0], blockchain.contractName()])[0];

    blockchain.callWithAuth(
        this._getRouter(),
        'swapExactTokensForTokens',
        [amountInStr,
         0,
         path,
         blockchain.contractName()]);
  }

  _swapAToB(tokenA, tokenB) {
    const pathArray = [];
    if (tokenA == 'iost') {
      pathArray.push([tokenA, tokenB]);
      if (tokenB != 'xusd') {
        pathArray.push([tokenA, 'xusd', tokenB]);
      }
    } else if (tokenA == 'xusd') {
      pathArray.push([tokenA, tokenB]);
      if (tokenB != 'iost') {
        pathArray.push([tokenA, 'iost', tokenB]);
      }
    } else {
      pathArray.push([tokenA, tokenB]);
      if (tokenB != 'iost') {
        pathArray.push([tokenA, 'iost', tokenB]);
      }
      if (tokenB != 'xusd') {
        pathArray.push([tokenA, 'xusd', tokenB]);
      }
    }

    const amountIn = new BigNumber(blockchain.call(
        'token.iost',
        'balanceOf',
        [tokenA, blockchain.contractName()])[0]);

    if (amountIn.eq(0)) {
      return;
    }

    const precision = this._checkPrecision(tokenA);

    var bestPath = '';
    var bestReturn = new BigNumber(0);

    for (let i = 0; i < pathArray.length; ++i) {
      const pathStr = JSON.stringify(pathArray[i]);
      const hasPath = +blockchain.call(this._getRouter(), 'hasPath', [pathStr])[0];
      if (hasPath) {
        const amounts = JSON.parse(blockchain.call(
            this._getRouter(), 'getAmountsOut', [amountIn.toFixed(precision, ROUND_DOWN), pathStr])[0]);
        if (!bestPath || bestReturn.lt(amounts[amounts.length - 1])) {
          bestPath = pathStr;
          bestReturn = new BigNumber(amounts[amounts.length - 1]);
        }
      }
    }

    blockchain.callWithAuth(
        this._getRouter(),
        'swapExactTokensForTokens',
        [amountIn.toFixed(precision, ROUND_DOWN),
         bestReturn.times(0.99).toFixed(precision, ROUND_DOWN),  // slippage 1%
         bestPath,
         blockchain.contractName()]);
  }

  removeLiquidity(tokenA, tokenB) {
    this._requireOwner();

    const pair = JSON.parse(blockchain.call(this._getSwap(), 'getPair', [tokenA, tokenB])[0]);
    const liquidity = blockchain.call('token.iost', 'balanceOf', [pair.xlp, blockchain.contractName()])[0];

    blockchain.callWithAuth(this._getSwap(), 'burn', [
        tokenA, tokenB, liquidity, blockchain.contractName(), blockchain.contractName()]);

    if (['xg','xusd','iost','vost'].indexOf(tokenA) < 0) {
      this._swapAToB(tokenA, 'xusd');
    }

    if (['xg','xusd','iost','vost'].indexOf(tokenB) < 0) {
      this._swapAToB(tokenB, 'xusd');
    }
  }

  _swapTokenToXG(token) {
    this._requireOwner();

    this._swapAToB(token, 'xg');
  }

  _random(base) {
    const hash = tx.hash;
    var result = 0;
    for (let i = 0; i < Math.min(hash.length, 16); ++i) {
      result = result * 2 + hash.charCodeAt(i) % 2;
    }
    return result % base;
  }

  maybeBurn() {
    this._requireOwner();

    const now = Math.floor(tx.time / 1e9);
    const nextLottery = this.getNextLottery();
    if (now < nextLottery) {
      throw "Xigua: lottery-not-ready";
    }

    const iostBalanceStr = blockchain.call(
        'token.iost',
        'balanceOf',
        ['iost', blockchain.contractName()])[0];
    const vostBalanceStr = blockchain.call(
        'token.iost',
        'balanceOf',
        ['vost', blockchain.contractName()])[0];

    const costStr = new BigNumber(iostBalanceStr).plus(
        vostBalanceStr).div(5000).toFixed(0, ROUND_DOWN);

    blockchain.transfer(tx.publisher,
                        blockchain.contractName(),
                        costStr,
                        "lottery");

    const r = this._random(1e4);

    if (r > 200) {
      blockchain.receipt(JSON.stringify(["random",
          r.toString()]));

      // 2% chance.
      this._setNextLottery(now + 600);  // 10 minutes.
      return '0';
    }

    this._setNextLottery(now + 3600 * 24 * 7);  // 1 week.

    this._swapAToBWithPath(['iost', 'xusd', 'xg']);
    this._swapAToBWithPath(['vost', 'xusd', 'xg']);
    this._swapAToBWithPath(['xusd', 'xg']);

    // Now burn 99% xg and send 1% xg.
    const xgBalanceStr = blockchain.call(
        'token.iost', 
        'balanceOf', 
        ['xg', blockchain.contractName()])[0];

    const bonusStr = new BigNumber(xgBalanceStr).div(100).toFixed(XG_PRECISION, ROUND_DOWN);
    const remainingStr = new BigNumber(xgBalanceStr).minus(bonusStr).toFixed(XG_PRECISION, ROUND_DOWN);

    blockchain.callWithAuth(
        'token.iost',
        'transfer',
        ['xg',
         blockchain.contractName(),
         tx.publisher,
         bonusStr,
         "lucky"]);

    blockchain.callWithAuth(
        'token.iost',
        'destroy',
        ['xg', blockchain.contractName(), remainingStr]);

    return bonusStr;
  }

  justBurn() {
    this._requireOwner();

    this._swapAToB('iost', 'xg');
    this._swapAToB('vost', 'xg');
    this._swapAToB('xusd', 'xg');

    const xgBalanceStr = blockchain.call(
        'token.iost',
        'balanceOf',
        ['xg', blockchain.contractName()])[0];

    blockchain.callWithAuth(
        'token.iost',
        'destroy',
        ['xg', blockchain.contractName(), xgBalanceStr]);

    const now = Math.floor(tx.time / 1e9);
    this._setNextLottery(now + 3600 * 24 * 7);  // 1 week.
  }

  swapToVost() {
    this._requireOwner();

    this._swapAToB('iost', 'vost');
    this._swapAToB('xg', 'vost');
    this._swapAToB('xusd', 'vost');
  }

  addLiquidity() {
    this._requireOwner();
    const vostAmountInStr = blockchain.call(
        'token.iost',
        'balanceOf',
        ['vost', blockchain.contractName()])[0];

    const oneSixthStr = new BigNumber(vostAmountInStr).div(6).toFixed(VOST_PRECISION, ROUND_DOWN);
    const halfStr = new BigNumber(vostAmountInStr).div(2).toFixed(VOST_PRECISION, ROUND_DOWN);

    const amountsXG = JSON.parse(blockchain.callWithAuth(
        this._getRouter(),
        'swapExactTokensForTokens',
        [oneSixthStr,
         '0',
         JSON.stringify(['vost', 'xusd', 'xg']),
         blockchain.contractName()])[0]);

    const amountsIOST = JSON.parse(blockchain.callWithAuth(
        this._getRouter(),
        'swapExactTokensForTokens',
        [oneSixthStr,
         '0',
         JSON.stringify(['vost', 'xusd', 'iost']),
         blockchain.contractName()])[0]);

    const amountsXUSD = JSON.parse(blockchain.callWithAuth(
        this._getRouter(),
        'swapExactTokensForTokens',
        [halfStr,
         '0',
         JSON.stringify(['vost', 'xusd']),
         blockchain.contractName()])[0]);

    const oneThirdXUSDStr = new BigNumber(amountsXUSD[1]).div(3).toFixed(XUSD_PRECISION, ROUND_DOWN);
    const oneThirdXUSDStrMin = new BigNumber(oneThirdXUSDStr).times(0.8).toFixed(XUSD_PRECISION, ROUND_DOWN);

    blockchain.callWithAuth(
        this._getRouter(),
        'addLiquidity',
        ['vost',
         'xusd',
         oneSixthStr,
         oneThirdXUSDStr,
         '0.1',//new BigNumber(oneSixthStr).times(0.7).toFixed(VOST_PRECISION, ROUND_DOWN),
         '0.1',//oneThirdXUSDStrMin,
         blockchain.contractName()]);
    blockchain.callWithAuth(
        this._getRouter(),
        'addLiquidity',
        ['iost',
         'xusd',
         amountsIOST[2],
         oneThirdXUSDStr,
         '0.1',//new BigNumber(amountsIOST[2]).times(0.7).toFixed(IOST_PRECISION, ROUND_DOWN),
         '0.1',//oneThirdXUSDStrMin,
         blockchain.contractName()]);
    blockchain.callWithAuth(
        this._getRouter(),
        'addLiquidity',
        ['xg',
         'xusd',
         amountsXG[2],
         oneThirdXUSDStr,
         '0.1',//new BigNumber(amountsXG[2]).times(0.7).toFixed(XG_PRECISION, ROUND_DOWN),
         '0.1',//oneThirdXUSDStrMin,
         blockchain.contractName()]);
  }
}

module.exports = Burner;
