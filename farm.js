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

# lockMap
[user] => {
  [token] => [[day, amount], ...]
}

# tokenArray

# totalAlloc

# pool
[token] => {
  total: "0", // How many tokens all users staked
  tokenPrecision: 0,
  extra: "",  // The extra token to mine besides XG, can be empty
  extraPrecision: 0,
  alloc: 1,
  lastRewardTime: 0,
  accPerShare: "0",
  accPerShareExtra: "0"
}

*/

const START_TIME = 1603800000 + 10800;  // 2020/10/27 3pm UTC (Beijing 11pm)
const XG_PER_DAY_BONUS = 50000;
const BONUS_END_TIME = 1607256000 + 10800;  // 40 days after START_TIME
const XG_PER_DAY_REGULAR = 10000;
const ALL_END_TIME = 1624536000 + 10800;  // 200 days after BONUS_END_TIME

const XG_PRECISION = 6;
const ROUND_DOWN = 1;

const PAD_PRECISION = 6;

const TIME_LOCK_DURATION = 12 * 3600; // 12 hours

const XG_LIST = ['xg_3', 'xg_30', 'xg_90', 'xg_180'];

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

  setFarmHelper(farmHelper) {
    this._requireOwner();

    storage.put("farmHelper", farmHelper);
  }

  _getFarmHelper() {
    return storage.get("farmHelper") || '';
  }

  setExtra(extra) {
    this._requireOwner();

    storage.put("extra", extra);
  }

  _getExtra() {
    return storage.get("extra") || '';
  }

  _getToday() {
    return Math.floor(tx.time / 1e9 / 3600 / 24);
  }

  _lock(who, token, amount, precision) {
    const map = JSON.parse(storage.mapGet("lockMap", who) || "{}");
    if (!map[token]) {
      map[token] = [];
    }

    const today = this._getToday();
    const last = map[token][map[token].length - 1];

    if (last && last[0] == today) {
      last[1] = new BigNumber(last[1]).plus(amount).toFixed(precision, ROUND_DOWN);
    } else {
      map[token].push([today, new BigNumber(amount).toFixed(precision, ROUND_DOWN)]);
    }

    storage.mapPut("lockMap", who, JSON.stringify(map));
  }

  _unlockInternal(who, token, amount, precision, today, days, willSave) {
    const map = JSON.parse(storage.mapGet("lockMap", who) || "{}");
    if (!map[token]) {
      map[token] = [];
    }

    var remain = new BigNumber(amount);

    while (map[token].length > 0 && remain.gt(0)) {
      const head = map[token][0];

      if (today < head[0] + days) {
        break;
      }

      if (remain.gte(head[1])) {
        remain = remain.minus(head[1]);
        map[token].shift();
      } else {
        head[1] = new BigNumber(head[1]).minus(remain).toFixed(precision, ROUND_DOWN);
        remain = new BigNumber(0);
        break;
      }
    }

    if (willSave) {
      storage.mapPut("lockMap", who, JSON.stringify(map));
    }

    // The actually withdraw amount.
    return new BigNumber(amount).minus(remain).toFixed(precision, ROUND_DOWN);
  }

  _unlock(who, token, amount, precision, days) {
    const today = this._getToday();
    return this._unlockInternal(who, token, amount, precision, today, days, true);
  }

  getCanUnlock(who, token, amount, precision, today, days) {
    precision *= 1;
    today *= 1;
    days *= 1;
    return this._unlockInternal(who, token, amount, precision, today, days, false);
  }

  _getUserInfo(who) {
    return JSON.parse(storage.mapGet("userInfo", who) || "{}");
  }

  getUserTokenAmount(who, tokenList) {
    tokenList = JSON.parse(tokenList);

    var total = new BigNumber(0);
    tokenList.forEach(token => {
      if (this._getUserInfo(who)[token]) {
        total = total.plus(this._getUserInfo(who)[token].amount);
      }
    });

    // HACK: Currently we only care about xg.
    return total.toFixed(6);
  }

  _setUserInfo(who, info) {
    storage.mapPut("userInfo", who, JSON.stringify(info));
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
    totalAlloc = (totalAlloc + delta).toFixed(1);

    if (totalAlloc < 0) {
      throw "Xigua: negative total alloc";
    }

    storage.put("totalAlloc", totalAlloc.toString());
  }

  _hasPool(token) {
    return storage.mapHas("pool", token);
  }

  _getPool(token) {
    return JSON.parse(storage.mapGet("pool", token) || "{}");
  }

  getPool(token) {
    return this._getPool(token);
  }

  _checkPrecision(symbol) {
    return +storage.globalMapGet("token.iost", "TI" + symbol, "decimal") || 0;
  }

  addPool(token, extra, alloc, willUpdate) {
    var symbol;
    if (XG_LIST.indexOf(token) >= 0) {
      symbol = "xg";
    } else {
      symbol = token;
    }

    this._requireOwnerOrAddress(this._getFarmHelper());

    alloc = +alloc || 0;
    willUpdate = +willUpdate || 0;

    if (this._hasPool(token)) {
      throw "pool exists";
    }

    if (willUpdate) {
      this.updateAllPools();
    }

    this._addToken(token);

    this._applyDeltaToTotalAlloc(alloc);

    storage.mapPut("pool", token, JSON.stringify({
      total: "0",
      tokenPrecision: this._checkPrecision(symbol),
      extra: extra,
      extraPrecision: extra ? this._checkPrecision(extra) : 0,
      alloc: alloc,
      lastRewardTime: 0,
      accPerShare: "0",
      accPerShareExtra: "0"
    }));
  }

  setPool(token, extra, alloc, willUpdate) {
    var symbol;
    if (XG_LIST.indexOf(token) >= 0) {
      symbol = "xg";
    } else {
      symbol = token;
    }

    this._requireOwnerOrAddress(this._getFarmHelper());

    alloc = +alloc || 0;
    willUpdate = +willUpdate || 0;

    if (!this._hasPool(token)) {
      throw "Xigua: NO_POOL_FOR_TOKEN";
    }

    if (willUpdate) {
      this.updateAllPools();
    }

    const pool = this._getPool(token);
    pool.tokenPrecision = this._checkPrecision(symbol);
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
    fromTime = Math.max(fromTime, START_TIME);
    toTime = Math.min(toTime, ALL_END_TIME);

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

  _updatePool(token, pool) {
    const now = Math.floor(tx.time / 1e9);

    if (now <= pool.lastRewardTime) {
      return;
    }

    const total = new BigNumber(pool.total);

    if (total.eq(0)) {
      pool.lastRewardTime = now;
      this._setPoolObj(token, pool);
      return;
    }

    // 1) Process XG

    const multiplier = this._getMultiplier(pool.lastRewardTime, now);
    const totalAlloc = this._getTotalAlloc();
    const reward = new BigNumber(multiplier).times(pool.alloc).div(totalAlloc);

    if (reward.gt(0)) {
      const rewardForFarmers = reward.times(0.9);
      const rewardForDev = reward.times(0.1);

      // Mint XG.
      blockchain.callWithAuth("token.iost", "issue",
          ["xg", blockchain.contractName(), rewardForFarmers.toFixed(XG_PRECISION, ROUND_DOWN)]);
      blockchain.callWithAuth("token.iost", "issue",
          ["xg", blockchain.contractOwner(), rewardForDev.toFixed(XG_PRECISION, ROUND_DOWN)]);

      // PAD_PRECISION here to make sure we have enough precision per share.
      pool.accPerShare = new BigNumber(pool.accPerShare).plus(rewardForFarmers.div(total)).toFixed(XG_PRECISION + PAD_PRECISION, ROUND_DOWN);
    }

    // 2) Precess Extra

    if (pool.extra) {
      const extraAmount = new BigNumber(blockchain.callWithAuth(this._getExtra(), "takeExtra", [pool.extra])[0]);

      if (extraAmount.gt(0)) {
        // PAD_PRECISION here to make sure we have enough precision per share.
        pool.accPerShareExtra = new BigNumber(pool.accPerShareExtra).plus(
            extraAmount.div(total)).toFixed(pool.extraPrecision + PAD_PRECISION, ROUND_DOWN);

        blockchain.receipt(JSON.stringify(["extra", pool.accPerShareExtra, total.toString(), extraAmount.toFixed(pool.extraPrecision)]));
      }
    }

    // 3) Done.

    pool.lastRewardTime = now;
    this._setPoolObj(token, pool);
  }

  updatePool(token) {
    if (!this._hasPool(token)) {
      throw "Xigua: NO_POOL_FOR_TOKEN";
    }

    const pool = this._getPool(token);

    this._updatePool(token, pool);
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

      return "0";
    }

    var accPerShare = new BigNumber(pool.accPerShare);
    const total = new BigNumber(pool.total);

    const now = Math.floor(tx.time / 1e9);

    if (now > pool.lastRewardTime && total.gt(0)) {
      const multiplier = this._getMultiplier(pool.lastRewardTime, now);
      const totalAlloc = this._getTotalAlloc();
      const reward = new BigNumber(multiplier).times(pool.alloc).div(totalAlloc);
      accPerShare = accPerShare.plus(reward.div(total));
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

      return "0";
    }

    var accPerShareExtra = new BigNumber(pool.accPerShareExtra);
    const total = new BigNumber(pool.total);
    const now = Math.floor(tx.time / 1e9);

    if (now > pool.lastRewardTime && total.gt(0)) {
      const extraAmount = blockchain.callWithAuth(this._getExtra(), "get", [pool.extra])[0];
      accPerShareExtra = accPerShareExtra.plus(extraAmount.div(total));
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

    this._updatePool(token, pool);

    var userAmount = new BigNumber(userInfo[token].amount);

    if (userAmount.gt(0)) {
      userInfo[token].rewardPending = userAmount.times(pool.accPerShare).minus(userInfo[token].rewardDebt).plus(userInfo[token].rewardPending).toFixed(XG_PRECISION, ROUND_DOWN);
      userInfo[token].extraPending = userAmount.times(pool.accPerShareExtra).minus(userInfo[token].extraDebt).plus(userInfo[token].extraPending).toFixed(pool.extraPrecision, ROUND_DOWN);
    }

    if (XG_LIST.indexOf(token) >= 0) {
      blockchain.callWithAuth("token.iost", "transfer",
          ["xg",
           tx.publisher,
           blockchain.contractName(),
           amountStr,
           "deposit"]);

      this._lock(tx.publisher, token, amountStr, XG_PRECISION);
    } else {
      blockchain.callWithAuth("token.iost", "transfer",
          [token,
           tx.publisher,
           blockchain.contractName(),
           amountStr,
           "deposit"]);
    }

    userAmount = userAmount.plus(amountStr);
    userInfo[token].amount = userAmount.toFixed(pool.tokenPrecision, ROUND_DOWN);
    userInfo[token].rewardDebt = userAmount.times(pool.accPerShare).toFixed(XG_PRECISION, ROUND_DOWN);
    userInfo[token].extraDebt = userAmount.times(pool.accPerShareExtra).toFixed(pool.extraPrecision, ROUND_DOWN);
    this._setUserInfo(tx.publisher, userInfo);

    pool.total = new BigNumber(pool.total).plus(amount).toFixed(pool.tokenPrecision, ROUND_DOWN);
    this._setPoolObj(token, pool);

    blockchain.receipt(JSON.stringify(["deposit", token, amountStr]));
  }

  withdraw(token) {
    if (!this._hasPool(token)) {
      throw "Xigua: NO_POOL_FOR_TOKEN";
    }

    var pool = this._getPool(token);

    const userInfo = this._getUserInfo(tx.publisher);

    if (!userInfo[token]) {
      // Empty pool
      return;
    }

    this._updatePool(token, pool);

    const userAmount = new BigNumber(userInfo[token].amount);
    const userAmountStr = userAmount.toFixed(pool.tokenPrecision, ROUND_DOWN);
    const pending = userAmount.times(pool.accPerShare).plus(
        userInfo[token].rewardPending).minus(userInfo[token].rewardDebt);
    const pendingStr = pending.toFixed(XG_PRECISION, ROUND_DOWN);
    const extraPending = userAmount.times(pool.accPerShareExtra).plus(
        userInfo[token].extraPending).minus(userInfo[token].extraDebt);
    const extraPendingStr = extraPending.toFixed(pool.extraPrecision, ROUND_DOWN);

    if (new BigNumber(pendingStr).gt(0)) {
      blockchain.callWithAuth("token.iost", "transfer",
          ["xg",
           blockchain.contractName(),
           tx.publisher,
           pendingStr,
           "withdraw"]);
      userInfo[token].rewardPending = "0";
    }

    if (new BigNumber(extraPendingStr).gt(0)) {
      if (pool.extra) {
        blockchain.callWithAuth("token.iost", "transfer",
            [pool.extra,
             blockchain.contractName(),
             tx.publisher,
             extraPendingStr,
             "withdraw"]);
      }
      userInfo[token].extraPending = "0";
    }

    var realAmountStr;

    if (XG_LIST.indexOf(token) >= 0) {
      const days = token.split("_")[1] * 1;
      realAmountStr = this._unlock(tx.publisher, token, userAmountStr, XG_PRECISION, days);

      if (new BigNumber(realAmountStr).lte(0)) {
        throw "Xigua: no available balance";
      }

      blockchain.callWithAuth("token.iost", "transfer",
          ["xg",
           blockchain.contractName(),
           tx.publisher,
           realAmountStr,
           "withdraw"]);
    } else {
      realAmountStr = userAmountStr;
      blockchain.callWithAuth("token.iost", "transfer",
          [token,
           blockchain.contractName(),
           tx.publisher,
           userAmountStr,
           "withdraw"]);
    }

    const userRemainingAmount = userAmount.minus(realAmountStr);

    if (userRemainingAmount.lt(0)) {
      throw "Xigua: invalid remaining amount";
    }

    userInfo[token].amount = userRemainingAmount.toFixed(pool.tokenPrecision, ROUND_DOWN);
    userInfo[token].rewardDebt = userRemainingAmount.times(pool.accPerShare).toFixed(XG_PRECISION, ROUND_DOWN);
    userInfo[token].extraDebt = userRemainingAmount.times(pool.accPerShareExtra).toFixed(pool.extraPrecision, ROUND_DOWN);
    this._setUserInfo(tx.publisher, userInfo);

    pool.total = new BigNumber(pool.total).minus(realAmountStr).toFixed(pool.tokenPrecision, ROUND_DOWN);
    this._setPoolObj(token, pool);

    blockchain.receipt(JSON.stringify(["withdraw", token, pendingStr, extraPendingStr, realAmountStr]));

    return realAmountStr;
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

    this._updatePool(token, pool);

    const userAmount = new BigNumber(userInfo[token].amount);
    const pending = userAmount.times(pool.accPerShare).plus(
        userInfo[token].rewardPending).minus(userInfo[token].rewardDebt);
    const pendingStr = pending.toFixed(XG_PRECISION, ROUND_DOWN);
    const extraPending = userAmount.times(pool.accPerShareExtra).plus(
        userInfo[token].extraPending).minus(userInfo[token].extraDebt);
    const extraPendingStr = extraPending.toFixed(pool.extraPrecision, ROUND_DOWN);

    if (pending.gt(0)) {
      blockchain.callWithAuth("token.iost", "transfer",
          ["xg",
           blockchain.contractName(),
           tx.publisher,
           pendingStr,
           "withdraw"]);
      userInfo[token].rewardPending = "0";
    }

    if (new BigNumber(extraPendingStr).gt(0)) {
      if (pool.extra) {
        blockchain.callWithAuth("token.iost", "transfer",
            [pool.extra,
             blockchain.contractName(),
             tx.publisher,
             extraPendingStr,
             "withdraw"]);
      }
      userInfo[token].extraPending = "0";
    }

    userInfo[token].rewardDebt = userAmount.times(pool.accPerShare).toFixed(XG_PRECISION, ROUND_DOWN);
    userInfo[token].extraDebt = userAmount.times(pool.accPerShareExtra).toFixed(pool.extraPrecision, ROUND_DOWN);
    this._setUserInfo(tx.publisher, userInfo);

    blockchain.receipt(JSON.stringify(["claim", token, pendingStr, extraPendingStr]));
  }

  getUserAmount(token, who) {
    const userInfo = this._getUserInfo(who);
    return userInfo[token] ? userInfo[token].amount : 0;
  }
}

module.exports = Farm;
