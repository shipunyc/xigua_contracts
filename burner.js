// Burner

const TIME_LOCK_DURATION = 12 * 3600; // 12 hours
const ROUND_DOWN = 1;

class Burner {

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
    return status == 1 || now < until;
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

  setRouter(router) {
    this._requireOwner();

    storage.put("router", router);
  }

  _getRouter() {
    return storage.get("router") || '';
  }

  swapTokenToXGAndBurn(token) {
    const pathArray = [];
    if (token == "iost") {
      pathArray.push(['iost', 'xg']);
      pathArray.push(['iost', 'xusd', 'xg']);
    } else if (token == "xusd") {
      pathArray.push(['xusd', 'xg']);
      pathArray.push(['xusd', 'iost', 'xg']);
    } else {
      pathArray.push([token, 'xg']);
      pathArray.push([token, 'iost', 'xg']);
      pathArray.push([token, 'xusd', 'xg']);
    }

    const amountIn = new BigNumber(blockchain.call(
        "token.iost",
        "balanceOf",
        [token, blockchain.contractName()])[0]);

    if (amountIn.eq(0)) {
      return;
    }

    const precision = this._checkPrecision(token);

    var bestPath = "";
    var bestReturn = new bigNumber(0);

    for (let i = 0; i < pathArray.length; ++i) {
      const pathStr = JSON.stringify(pathArray[i]);
      const hasPath = +blockchain.call(this._getRouter(), "hasPath", [pathStr])[0];
      if (hasPath) {
        const amounts = JSON.parse(blockchain.call(
            this._getRouter(), "getAmountsOut", amountIn.toFixed(precision, ROUND_DOWN), pathStr)[0]);
        if (!bestPath || bestReturn.lt(amounts[amounts.length - 1])) {
          bestPath = pathStr;
          bestReturn = new BigNumber(amounts[amounts.length - 1]);
        }
      }
    }

    blockchain.callWithAuth(
        this._getRouter(),
        "swapExactTokensForTokens"
        [amountIn.toFixed(precision, ROUND_DOWN),
         bestReturn.times(0.99).toFixed(precision, ROUND_DOWN),  // slippage 1%
         path,
         blockchain.contractName()]);

    // Now burn all xg.
    const xgBalanceStr = blockchain.call(
        "token.iost", 
        "balanceOf", 
        ["xg", blockchain.contractName()]);

    blockchain.callWithAuth(
        "token.iost",
        "destroy",
        ["xg", blockchain.contractName(), xgBalanceStr]);
  }
}

module.exports = Burner;
