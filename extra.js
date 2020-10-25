// Extra

const VOST_PRECISION = 8;
const XUSD_PRECISION = 6;
const MINIMUM_VOST_UNIT = 100;
const ROUND_DOWN = 1;
const TIME_LOCK_DURATION = 12 * 3600; // 12 hours

class Extra {

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
    if (!blockchain.requireAuth(blockchain.contractOwner(), "active")) {
      throw "only owner can change";
    }

    storage.put("router", router);
  }

  _getRouter() {
    return storage.get("router") || '';
  }

  setFarm(farm) {
    this._requireOwner();

    storage.put("farm", farm);
  }

  _getFarm() {
    return storage.get("farm") || '';
  }

  _setBalance(balanceStr) {
    storage.put("balance", balanceStr);
  }

  _getBalance() {
    return new BigNumber(storage.get("balance") || "0");
  }

  _setQueue(queue) {
    storage.put("queue", JSON.stringify(queue));
  }

  _getQueue() {
    return JSON.parse(storage.get("queue") || "[]");
  }

  _setLastTime(lastTime) {
    storage.put("lastTime", JSON.stringify(lastTime));
  }

  _getLastTime() {
    return JSON.parse(storage.get("lastTime") || "0");
  }

  // Farm is the only caller (for now).
  takeExtra(token) {
    if (!blockchain.requireAuth(this._getFarm(), "active")) {
      throw "only approved contracts can issue";
    }

    if (token != "xusd") {
      throw "currently only xusd is support";
    }

    const queue = this._getQueue();
    const lastTime = this._getLastTime();
    const now = Math.floor(tx.time / 1e9);

    var amountToSwap = new BigNumber(0);

    for (let i = 0; i < queue.length; ++i) {
      const time = Math.min(now, queue[i].startTime + 3600 * 24);
      const amount = new BigNumber(queue[i].delta).times(
          time - lastTime).div(3600 * 24);
      amountToSwap = amountToSwap.plus(amount);
    }

    this._setLastTime(now);

    const oldBalance = this._getBalance();
    const newBalance = new BigNumber(blockchain.call("token.iost", "balanceOf", ["vost", blockchain.contractName()])[0]);

    // Queue in
    if (newBalance.minus(oldBalance).gte(MINIMUM_VOST_UNIT)) {
      // Every time the vost balance goes up, it will be distributed in the next
      // 24 hours evenly.
      const delta = newBalance.minus(oldBalance);
      queue.push({
        startTime: now,
        delta: delta.toFixed(VOST_PRECISION, ROUND_DOWN)
      });
    }

    // Queue out
    if (queue[0] && now >= queue[0].startTime + 24 * 3600) {
      queue.shift();
    }

    this._setQueue(queue);

    // amountToSwap should be less than current balance in case
    // there is calculator error due to rounding.
    if (amountToSwap.gt(newBalance)) {
      amountToSwap = newBalance;
    }

    if (amountToSwap.lt(MINIMUM_VOST_UNIT)) {
      return "0";
    }

    // Now convert sum of vost into xusd, and send to farm.

    const pathArray = [[
      'vost', 'iost', 'xusd'
    ], [
      'vost', 'xusd'
    ]];

    var bestPath = "";
    var bestReturn = new BigNumber(0);

    for (let i = 0; i < pathArray.length; ++i) {
      const pathStr = JSON.stringify(pathArray[i]);
      const hasPath = +blockchain.call(this._getRouter(), "hasPath", [pathStr])[0];
      if (hasPath) {
        const amounts = JSON.parse(blockchain.call(
            this._getRouter(), "getAmountsOut", [amountToSwap.toFixed(VOST_PRECISION, ROUND_DOWN), pathStr])[0]);
        if (!bestPath || bestReturn.lt(amounts[amounts.length - 1])) {
          bestPath = pathStr;
          bestReturn = new BigNumber(amounts[amounts.length - 1]);
        }
      }
    }

    const amountsFinal = JSON.parse(blockchain.callWithAuth(
        this._getRouter(),
        "swapExactTokensForTokens",
        [amountToSwap.toFixed(VOST_PRECISION, ROUND_DOWN),
         bestReturn.times(0.99).toFixed(XUSD_PRECISION, ROUND_DOWN),  // slippage 1%
         bestPath,
         blockchain.contractName()])[0]);

    const xusdAmountStr = amountsFinal[amountsFinal.length - 1];

    // Now send XUSD to farm.
    blockchain.callWithAuth("token.iost", "transfer",
        ["xusd",
         blockchain.contractName(),
         this._getFarm(),
         xusdAmountStr,
         "take extra"]);

    // Update vost balance before we go.
    this._setBalance(blockchain.call("token.iost", "balanceOf", ["vost", blockchain.contractName()])[0]);

    return xusdAmountStr;
  }
}

module.exports = Extra;
