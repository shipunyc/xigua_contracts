// Farm

/*

# dev

# userInfo
[user] => {
  [token]: {
    amount: "0",  // How many tokens the user provided
    rewardPending: "0",
    rewardDebt: "0",
    extraPending: "0",
    extraDebt: "0"
  }
  // Reward debt. See explanation below.
  //
  // We do some fancy math here. Basically, any point in time, the amount of SUSHIs
  // entitled to a user but is pending to be distributed is:
  //
  //   pending reward = (user.amount * pool.accPerShare) - user.rewardDebt
  //
  // Whenever a user deposits or withdraws LP tokens to a pool. Here's what happens:
  //   1. The pool's `accPerShare` (and `lastRewardBlock`) gets updated.
  //   2. User receives the pending reward sent to his/her address.
  //   3. User's `amount` gets updated.
  //   4. User's `rewardDebt` gets updated.
}

# allPoolIds

# totalAlloc

# pool
[token] => {
  tokenPrecision: 0,
  extra: "",  // The extra token to mine besides XG, can be empty
  extraPrecision: 0,
  alloc: "",
  lastRewardTime: 0,
  accPerShare: "0",
  accPerShareExtra: "0"
}

*/

const START_TIME = 1603800000;  // 2020/10/27 12pm UTC (Beijing 8pm)
const XG_PER_DAY_BONUS = 50000;
const BONUS_END_TIME = 1607256000;  // 40 days after START_TIME
const XG_PER_DAY_REGULAR = 10000;
const ALL_END_TIME = 1624536000;  // 200 days after BONUS_END_TIME

const XG_PRECISION = 6;
const ROUND_DOWN = 1;

const TIME_LOCK_DURATION = 12 * 3600; // 12 hours

class Farm {

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

  _requireOwnerOrAddress(address) {
    if(!blockchain.requireAuth(blockchain.contractOwner(), 'active') &&
       !blockchain.requireAuth(address, 'active')){
      throw 'require auth failed';
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

  /*
  createXG() {
    if (!blockchain.requireAuth(blockchain.contractOwner(), "active")) {
      throw "only owner can change";
    }

    const config = {
      "decimal": 6,
      "canTransfer": true,
      "fullName": "Xigua Token"
    };

    blockchain.callWithAuth("token.iost", "create",
        ['xg', blockchain.contractName(), 4000000, config]);
  }
  */

  setFarmAdmin(farmAdmin) {
    this._requireOwner();

    storage.put("farmAdmin", farmAdmin);
  }

  _getFarmAdmin() {
    return storage.get("farmAdmin") || '';
  }

  setExtra(extra) {
    this._requireOwner();

    storage.put("extra", extra);
  }

  _getExtra() {
    return storage.get("extra") || '';
  }

  _getUserInfo(who) {
    return JSON.parse(storage.mapGet("userInfo", who) || "{}");
  }

  _setUserInfo(who, info) {
    storage.mapPut(who, JSON.stringify(info));
  }

  _getTokenArray() {
    return JSON.parse(storage.get("tokenArray") || "[]");
  }

  _addToken(token) {
    const tokenArray = this._getTokenArray();

    if (tokenArray.indexOf(token) < 0) {
      tokenArray.push(token);
    }

    storage.put("tokenArray", JSON.stringify(tokenArray));
  }

  _getTotalAlloc() {
    return +storage.get("totalAlloc") || 0;
  }

  _applyDeltaToTotalAlloc(delta) {
    var totalAlloc = this._getTotalAlloc();
    totalAlloc += delta;

    if (totalAlloc < 0) {
      throw "Xigua: negative total alloc";
    }

    storage.put("totalAlloc", totalAlloc);
  }

  _hasPool(token) {
    return storage.mapHas("pool", token);
  }

  _getPool(token) {
    return JSON.parse(storage.mapGet("pool", token) || "{}");
  }

  _checkPrecision(symbol) {
    return +storage.globalMapGet("token.iost", "TI" + symbol, "decimal") || 0;
  }

  addPool(token, extra, alloc, willUpdate) {
    this._requireOwnerOrAddress(this._getFarmAdmin());

    if (this._hasPool(token)) {
      throw "pool exists";
    }

    if (willUpdate) {
      this.updateAllPools();
    }

    this._addToken(token);

    this._applyDeltaToTotalAlloc(alloc);

    storage.mapPut("pool", token, JSON.stringify({
      tokenPrecision: this._checkPrecision(token),
      extra: extra,
      extraPrecision: extra ? this._checkPrecision(extra) : 0,
      alloc: alloc,
      lastRewardTime: 0,
      accPerShare: 0,
      accPerShareExtra: 0
    }));
  }

  setPool(token, extra, alloc, willUpdate) {
    this._requireOwnerOrAddress(this._getFarmAdmin());

    if (!this._hasPool(token)) {
      throw "Xigua: NO_POOL_FOR_TOKEN";
    }

    if (willUpdate) {
      this.updateAllPools();
    }

    const pool = this._getPool(token);
    pool.extra = extra;
    pool.extraPrecision = extra ? this._checkPrecision(extra) : 0;
    this._applyDeltaToTotalAlloc(alloc - pool.alloc);
    pool.alloc = alloc;
    storage.mapPut("pool", token, JSON.stringify(pool));
  }

  _setPoolObj(token, pool) {
    storage.mapPut("pool", token, JSON.stringify(pool));
  }

  _getMultiplier(fromTime, toTime) {
    if (toTime <= START_TIME || fromTime >= ALL_END_TIME) {
      return 0;
    }

    if (toTime <= BONUS_END_TIME) {
      return new BigNumber(XG_PER_DAY_BONUS).times(toTime - fromTime).div(3600 * 24);
    }

    if (fromTime >= BONUS_END_TIME) {
      return new BigNumber(XG_PER_DAY_REGULAR).times(toTime - fromTime).div(3600 * 24);
    }

    return new BigNumber(XG_PER_DAY_BONUS).times(BONUS_END_TIME - fromTime).plus(
        new BigNumber(XG_PER_DAY_REGULAR).times(toTime - BONUS_END_TIME)).div(3600 * 24);
  }

  updatePool(token) {
    if (!this._hasPool(token)) {
      throw "Xigua: NO_POOL_FOR_TOKEN";
    }

    const pool = this._getPool(token);
    const now = Math.floor(tx.time / 1e9);

    if (now <= pool.lastRewardTime) {
      return;
    }

    const total = new BigNumber(blockchain.call(
        "token.iost", "balanceOf", [token, blockchain.contractName()])[0]);

    if (total == 0) {
      pool.lastRewardTime = now;
      this._setPoolObj(token, pool);
      return;
    }

    // 1) Process XG

    const multiplier = this._getMultiplier(pool.lastRewardTime, now);
    const totalAlloc = this._getTotalAlloc();
    const reward = multiplier.times(pool.alloc).div(totalAlloc);
    const rewardForFarmers = reward.times(0.9);
    const rewardForDev = reward.times(0.1);

    // Mint XG.
    blockchain.callWithAuth("token.iost", "issue",
        ["xg", blockchain.contractName(), rewardForFarmers.toFixed(XG_PRECISION, ROUND_DOWN)]);
    blockchain.callWithAuth("token.iost", "issue",
        ["xg", blockchain.contractName(), rewardForDev.toFixed(XG_PRECISION, ROUND_DOWN)]);

    pool.accPerShare = new BigNumber(pool.accPerShare).plus(rewardForFarmers.div(total)).toFixed(XG_PRECISION, ROUND_DOWN);

    // 2) Precess Extra

    if (pool.extra) {
      const extraAmount = new BigNumber(blockchain.callWithAuth(this._getExtra(), "takeExtra", [pool.extra])[0]);
      pool.accPerShareExtra = new BigNumber(pool.accPerShareExtra).plus(
          extraAmount.div(total)).toFixed(pool.extraPrecision, ROUND_DOWN);
    }

    // 3) Done.

    pool.lastRewardTime = now;
    this._setPoolObj(token, pool);
  }

  updateAllPools() {
    const tokenArray = this._getTokenArray();
    tokenArray.forEach(token => {
      this.updatePool(token);
    });
  }

  getRewardPending(who, token) {
    if (!this._hasPool(token)) {
      throw "Xigua: NO_POOL_FOR_TOKEN";
    }

    const pool = this._getPool(token);
    const userInfo = this._getUserInfo(who);

    if (!userInfo[token]) {
      userInfo[token] = {
        amount: "0",
        rewardPending: "0",
        rewardDebt: "0",
        extraPending: "0",
        extraDebt: "0"
      }
    }

    const accPerShare = new BigNumber(pool.accPerShare);
    const total = new BigNumber(blockchain.call(
        "token.iost", "balanceOf", [token, blockchain.contractName()])[0]);   
    const now = Math.floor(tx.time / 1e9);

    if (now > pool.lastRewardTime && total.gt(e)) {
      const multiplier = this._getMultiplier(pool.lastRewardTime, now);
      const totalAlloc = this._getTotalAlloc();
      const reward = multiplier.times(pool.alloc).div(totalAlloc);
      accPerShare = accPerShare.plus(reward).div(total);
    }

    return accPerShare.times(userInfo[token].amount).plus(
        userInfo[token].rewardPending).minus(
            userInfo[token].rewardDebt).toFixed(XG_PRECISION, ROUND_DOWN);
  }

  getExtraPending(who, token) {
    if (!this._hasPool(token)) {
      throw "Xigua: NO_POOL_FOR_TOKEN";
    }

    const pool = this._getPool(token);

    if (!pool.extra) {
      return 0;
    }

    const userInfo = this._getUserInfo(who);

    if (!userInfo[token]) {
      userInfo[token] = {
        amount: "0",
        rewardPending: "0",
        rewardDebt: "0",
        extraPending: "0",
        extraDebt: "0"
      }
    }

    const accPerShareExtra = new BigNumber(pool.accPerShareExtra);
    const total = new BigNumber(blockchain.call(
        "token.iost", "balanceOf", [token, blockchain.contractName()])[0]);
    const now = Math.floor(tx.time / 1e9);

    if (now > pool.lastRewardTime && total.gt(e)) {
      const extraAmount = blockchain.callWithAuth(this._getExtra(), "get", [pool.extra])[0];
      accPerShareExtra = accPerShareExtra.plus(extraAmount).div(total);
    }

    return accPerShareExtra.times(userInfo[token].amount).plus(
        userInfo[token].extraPending).minus(
            userInfo[token].extraDebt).toFixed(pool.extraPrecision, ROUND_DOWN);
  }

  deposit(token, amount) {
    if (!this._hasPool(token)) {
      throw "Xigua: NO_POOL_FOR_TOKEN";
    }

    const pool = this._getPool(token);

    amount = new BigNumber(amount);
    const amountStr = amount.toFixed(pool.tokenPrecision, ROUND_DOWN);
    amount = new BigNumber(amount);

    if (amount.lte(0)) {
      throw "Xigua: INVALID_AMOUNT";
    }

    const userInfo = this._getUserInfo(tx.publisher);

    if (!userInfo[token]) {
      userInfo[token] = {
        amount: "0",
        rewardPending: "0",
        rewardDebt: "0",
        extraPending: "0",
        extraDebt: "0"
      }
    }

    this.updatePool(token);

    const userAmount = new BigNumber(userInfo[token].amount);

    if (userAmount.gt(0)) {
      userInfo[token].rewardPending = userAmount.times(pool.accPerShare).minus(userInfo[token].rewardDebt);
      userInfo[token].extraPending = userAmount.times(pool.accPerShareExtra).minus(userInfo[token].extraDebt);
    }

    blockchain.callWithAuth("token.iost", "transfer",
          [token,
           tx.publisher,
           blockchain.contractName(),
           amountStr,
           "deposit"]);

    userInfo[token].rewardDebt = userAmount.times(pool.accPerShare).toFixed(XG_PRECISION);
    userInfo[token].extraDebt = userAmount.times(pool.accPerShareExtra).toFixed(pool.precision);
    this._setUserInfo(tx.publisher, userInfo);

    blockchain.receipt(JSON.stringify(["deposit", token, amountStr]));
  }

  withdraw(token) {
    if (!this._hasPool(token)) {
      throw "Xigua: NO_POOL_FOR_TOKEN";
    }

    const pool = this._getPool(token);

    const userInfo = this._getUserInfo(tx.publisher);

    if (!userInfo[token]) {
      // Empty pool
      return;
    }

    this.updatePool(token);

    const userAmount = new BigNumber(userInfo[token].amount);
    const userAmountStr = userAmount.toFixed(pool.tokenPrecision);
    const pending = userAmount.times(pool.accPerShare).plus(
        userInfo[token].rewardPending).minus(userInfo[token].rewardDebt);
    const pendingStr = pending.toFixed(XG_PRECISION);
    const extraPending = userAmount.times(pool.accPerShareExtra).plus(
        userInfo[token].extraPending).minus(userInfo[token].extraDebt);
    const extraPendingStr = extraPending.toFixed(pool.extraPresicion);

    if (pending.gt(0)) {
      blockchain.callWithAuth("token.iost", "transfer",
          ["xg",
           blockchain.contractName(),
           tx.publisher,
           pendingStr,
           "withdraw"]);
      userInfo[token].rewardPending = "0";
    }

    if (extraPending.gt(0)) {
      blockchain.callWithAuth("token.iost", "transfer",
          [pool.extra,
           blockchain.contractName(),
           tx.publisher,
           extraPendingStr,
           "withdraw"]);
      userInfo[token].extraPending = "0";
    }

    blockchain.callWithAuth("token.iost", "transfer",
          [token,
           blockchain.contractName(),
           tx.publisher,
           userAmountStr,
           "deposit"]);
    userInfo[token].amount = "0";
    userInfo[token].rewareDebt = userAmount.times(pool.accPerShare).toFixed(XG_PRECISION);
    userInfo[token].extraDebt = userAmount.times(pool.accPerShareExtra).toFixed(pool.extraPrecision);
    this._setUserInfo(tx.publisher, userInfo);

    blockchain.receipt(JSON.stringify(["withdraw", token, pendingStr, extraPendingStr, userAmountStr]));
  }

  claim(token) {
    if (!this._hasPool(token)) {
      throw "Xigua: NO_POOL_FOR_TOKEN";
    }

    const pool = this._getPool(token);

    const userInfo = this._getUserInfo(tx.publisher);

    if (!userInfo[token]) {
      // Empty pool
      return;
    }

    this.updatePool(token);

    const userAmount = new BigNumber(userInfo[token].amount);
    const pending = userAmount.times(pool.accPerShare).plus(
        userInfo[token].rewardPending).minus(userInfo[token].rewardDebt);
    const pendingStr = pending.toFixed(XG_PRECISION);
    const extraPending = userAmount.times(pool.accPerShareExtra).plus(
        userInfo[token].extraPending).minus(userInfo[token].extraDebt);
    const extraPendingStr = extraPending.toFixed(pool.extraPresicion);

    if (pending.gt(0)) {
      blockchain.callWithAuth("token.iost", "transfer",
          ["xg",
           blockchain.contractName(),
           tx.publisher,
           pendingStr,
           "withdraw"]);
      userInfo[token].rewardPending = "0";
    }

    if (extraPending.gt(0)) {
      blockchain.callWithAuth("token.iost", "transfer",
          [pool.extra,
           blockchain.contractName(),
           tx.publisher,
           extraPendingStr,
           "withdraw"]);
      userInfo[token].extraPending = "0";
    }

    userInfo[token].rewareDebt = userAmount.times(pool.accPerShare).toFixed(XG_PRECISION);
    userInfo[token].extraDebt = userAmount.times(pool.accPerShareExtra).toFixed(pool.extraPrecision);
    this._setUserInfo(tx.publisher, userInfo);

    blockchain.receipt(JSON.stringify(["claim", token, pendingStr, extraPendingStr]));
  }

  getUserAmount(token, who) {
    const userInfo = this._getUserInfo(who);
    return userInfo[token] ? userInfo[token].amount : 0;
  }
}

module.exports = Farm;
