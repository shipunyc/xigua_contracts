// Extra

const IOST_PRECISION = 8;
const MINIMUM_IOST_UNIT = 200;
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
    storage.put("balance", balanceStr.toString());
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

  clear() {
    this._requireOwner();
    this._setBalance("0");
    this._setQueue([]);
  }

  // Farm is the only caller (for now).
  takeExtra(token) {
    if (!blockchain.requireAuth(this._getFarm(), "active")) {
      throw "only approved contracts can issue";
    }

    if (token != "iost") {
      throw "currently only iost is supported";
    }

    const queue = this._getQueue();
    const lastTime = this._getLastTime();
    const now = Math.floor(tx.time / 1e9);

    var amountToSend = new BigNumber(0);

    for (let i = 0; i < queue.length; ++i) {
      const time = Math.min(now, queue[i].startTime + 3600 * 24);
      const lastTimeI = Math.max(lastTime, queue[i].startTime);
      const amount = new BigNumber(queue[i].delta).times(
          time - lastTimeI).div(3600 * 24);
      amountToSend = amountToSend.plus(amount);
    }

    const oldBalance = this._getBalance();
    const newBalance = new BigNumber(blockchain.call("token.iost", "balanceOf", ["iost", blockchain.contractName()])[0]);

    // Queue in
    if (newBalance.minus(oldBalance).gte(MINIMUM_IOST_UNIT)) {
      // Every time the iost balance goes up, it will be distributed in the next
      // 24 hours evenly.
      const delta = newBalance.minus(oldBalance);
      queue.push({
        startTime: now,
        delta: delta.toFixed(IOST_PRECISION, ROUND_DOWN)
      });

      this._setBalance(newBalance.toFixed(IOST_PRECISION, ROUND_DOWN));
    }

    // Queue out
    if (queue[0] && lastTime >= queue[0].startTime + 24 * 3600) {
      queue.shift();
    }

    this._setQueue(queue);

    // amountToSend should be less than current balance in case
    // there is calculator error due to rounding.
    if (amountToSend.gt(newBalance)) {
      amountToSend = newBalance;
    }

    if (amountToSend.lt(MINIMUM_IOST_UNIT)) {
      return "0";
    }

    this._setLastTime(now);

    const amountToSendStr = amountToSend.toFixed(IOST_PRECISION, ROUND_DOWN);

    // Now send iost to farm.
    blockchain.callWithAuth("token.iost", "transfer",
        ["iost",
         blockchain.contractName(),
         this._getFarm(),
         amountToSendStr,
         "take extra"]);

    // Update iost balance before we go.
    this._setBalance(blockchain.call("token.iost", "balanceOf", ["iost", blockchain.contractName()])[0]);

    return amountToSendStr;
  }
}

module.exports = Extra;
