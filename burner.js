// Burner

class Burner {

  init() {
  }

  can_update(data) {
    return blockchain.requireAuth(blockchain.contractOwner(), "active");
  }

  setRouter(router) {
    if (!blockchain.requireAuth(blockchain.contractOwner(), "active")) {
      throw "only owner can change";
    }

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

    const amountIn = +blockchain.call(
        "token.iost",
        "balanceOf",
        [token, blockchain.contractName()])[0];

    if (!amountIn) {
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
            this._getRouter(), "getAmountsOut", amountIn.toFixed(precision), pathStr)[0]);
        if (!bestPath || bestReturn.lt(amounts[amounts.length - 1])) {
          bestPath = pathStr;
          bestReturn = new BigNumber(amounts[amounts.length - 1]);
        }
      }
    }

    blockchain.callWithAuth(
        this._getRouter(),
        "swapExactTokensForTokens"
        [amountIn.toFixed(precision),
         bestReturn.times(0.99).toFixed(precision),  // slippage 1%
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
