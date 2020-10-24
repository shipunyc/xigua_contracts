// Bank

/*

#maxRatio 2.5

#minRatio 1.5

#price

#info
user => {
  locked:
  borrowed:
}

#liquidation
tx.hash => {
}

#vostBalance

*/

const IOST_PRECISION = 8;
const VOST_PRECISION = 8;
const XUSD_PRECISION = 6;
const ROUND_DOWN = 1;
const DEFAULT_MINUTES = "10";

class Bank {

  init() {
  }

  can_update(data) {
    return blockchain.requireAuth(blockchain.contractOwner(), "active") && !this.isLocked();
  }

  _requireOwner() {
    if (!blockchain.requireAuth(blockchain.contractOwner(), 'active')){
      throw 'require auth error:not contractOwner';
    }
  }

  isLocked() {
    const now = Math.floor(tx.time / 1e9);
    const status = +storage.get("timeLockStatus") || 0;
    const until = +storage.get("timeLockUntil") || 0;
    return status == 1 || now < until;
  }

  _requireUnlocked() {
    if (this.isLocked()) {
      throw "Xigua: IS_LOCKED";
    }
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
  createXUSD() {
    if (!blockchain.requireAuth(blockchain.contractOwner(), "active")) {
      throw "only owner can change";
    }

    const config = {
      "decimal": 6,
      "canTransfer": true,
      "fullName": "Xigua USD"
    };

    blockchain.callWithAuth("token.iost", "create",
        ['xusd', blockchain.contractName(), 999999999999, config]);
  }
  */

  setExtra(extra) {
    this._requireOwner();

    storage.put("extra", extra);
  }

  _getExtra() {
    return storage.get("extra") || '';
  }

  setExtra(feeTo) {
    this._requireOwner();

    storage.put("feeTo", feeTo);
  }

  _getFeeTo() {
    return storage.get("feeTo") || '';
  }

  setOracle(oracle) {
    this._requireOwner();
    this._requireUnlocked();

    storage.put("oracle", oracle);
  }

  _getOracle() {
    return storage.get("oracle");
  }

  setLiebi(liebi) {
    this._requireOwner();
    this._requireUnlocked();

    storage.put("liebi", liebi);
  }

  _getLiebi() {
    return storage.get("liebi");
  }

  setMinRatio(minRatio) {
    this._requireOwner();
    this._requireUnlocked();

    storage.put("minRatio", minRatio.toString());
  }

  _getMinRatio() {
    return +storage.get("minRatio") || 1.5;
  }

  setMaxRatio(maxRatio) {
    this._requireOwner();
    this._requireUnlocked();

    storage.put("maxRatio", maxRatio.toString());
  }

  _getMaxRatio() {
    return +storage.get("maxRatio") || 2.5;
  }

  _setInfo(who, info) {
    storage.mapPut("info", who, JSON.stringify(info));
  }

  getInfo(who) {
    return JSON.parse(storage.mapGet("info", who) || "null");
  }

  _setLiquidation(hash, liquidation) {
    storage.mapPut("liquidation", hash, JSON.stringify(liquidation));
  }

  getLiquidation(hash) {
    return JSON.parse(storage.mapGet("liquidation", hash) || "null");
  }

  _plusVOSTBalance(delta) {
    var balance = new BigNumber(storage.get("vostBalance") || "0");
    balance = balance.plus(delta);
    storage.put("vostBalance", balance.toFixed(VOST_PRECISION, ROUND_DOWN));
  }

  _minusVOSTBalance(delta) {
    var balance = new BigNumber(storage.get("vostBalance") || "0");
    balance = balance.minus(delta);
    storage.put("vostBalance", balance.toFixed(VOST_PRECISION, ROUND_DOWN));
  }

  _getVOSTBalance() {
    return storage.get("vostBalance");
  }

  lock(iostAmount) {
    iostAmount = new BigNumber(iostAmount);
    const iostAmountStr = iostAmount.toFixed(IOST_PRECISION, ROUND_DOWN);
    iostAmount = new BigNumber(iostAmountStr);

    if (iostAmount.lte(0)) {
      throw "Xigua: invalid iost amount";
    }

    const info = this.getInfo(tx.publisher) || {locked: "0", borrowed: "0"};

    // Transfers iost.
    blockchain.transfer(tx.publisher,
                        blockchain.contractName(),
                        iostAmountStr,
                        "lock");

    // Change iost into vost.
    blockchain.callWithAuth(this._getLiebi(),
                            "toVOST",
                            [blockchain.contractName(), iostAmountStr]);

    this._plusVOSTBalance(iostAmount);

    info.locked = new BigNumber(info.locked).plus(iostAmount).toFixed(IOST_PRECISION, ROUND_DOWN);
    this._setInfo(tx.publisher, info);

    blockchain.receipt(JSON.stringify(["lock",
        tx.publisher,
        iostAmountStr,
        info.locked,
        info.borrowed]));
  }

  _unlockInternal(iostAmount) {
    if (iostAmount.lte(0)) {
      throw "Xigua: invalid iost amount";
    }

    const info = this.getInfo(tx.publisher) || {locked: "0", borrowed: "0"};
    const price = blockchain.call(this._getOracle(), "getAverageGoodPrice", [DEFAULT_MINUTES])[0];
    const canUnlockAmount = new BigNumber(info.locked).minus(
        new BigNumber(info.borrowed).times(this._getMaxRatio()).div(price));

    if (canUnlockAmount.lt(iostAmount)) {
      throw "Not enough to unlock";
    }

    this._minusVOSTBalance(iostAmount);

    // Updates info.
    info.locked = new BigNumber(info.locked).minus(iostAmount).toFixed(IOST_PRECISION, ROUND_DOWN);
    this._setInfo(tx.publisher, info);

    return info;
  }

  unlockWithDelay(iostAmount) {
    iostAmount = new BigNumber(iostAmount);
    const iostAmountStr = iostAmount.toFixed(IOST_PRECISION, ROUND_DOWN);
    iostAmount = new BigNumber(iostAmountStr);

    const info = this._unlockInternal(iostAmount);

    // Now let's unlock from liebi.
    blockchain.callWithAuth("token.iost", "transfer",
        ["vost",
         blockchain.contractName(),
         tx.publisher,
         iostAmountStr,
         "unlock with delay"]);

    blockchain.callWithAuth(this._getLiebi(),
                            "toIOSTDelay",
                            [tx.publisher, iostAmountStr]);

    blockchain.receipt(JSON.stringify(["unlockWithDelay",
        tx.publisher,
        iostAmountStr,
        info.locked,
        info.borrowed]));
  }

  unlockImmediately(iostAmount) {
    iostAmount = new BigNumber(iostAmount);
    const iostAmountStr = iostAmount.toFixed(IOST_PRECISION, ROUND_DOWN);
    iostAmount = new BigNumber(iostAmountStr);

    const info = this._unlockInternal(iostAmount);

    // Now let's unlock from liebi.
    blockchain.callWithAuth("token.iost", "transfer",
        ["vost",
         blockchain.contractName(),
         tx.publisher,
         iostAmountStr,
         "unlock immediately"]);

    blockchain.callWithAuth(this._getLiebi(),
                            "toIOST",
                            [tx.publisher, iostAmountStr]);
    blockchain.receipt(JSON.stringify(["unlockImmediately",
        tx.publisher,
        iostAmountStr,
        info.locked,
        info.borrowed]));
  }

  borrow(xusdAmount) {
    xusdAmount = new BigNumber(xusdAmount);
    const xusdAmountStr = xusdAmount.toFixed(XUSD_PRECISION, ROUND_DOWN);
    xusdAmount = new BigNumber(xusdAmountStr);

    if (xusdAmount.lte(0)) {
      throw "Xigua: invalid xusd amount";
    }

    const info = this.getInfo(tx.publisher) || {locked: "0", borrowed: "0"};
    const price = blockchain.call(this._getOracle(), "getAverageGoodPrice", [DEFAULT_MINUTES])[0];
    const canBorrow = new BigNumber(info.locked).times(price).div(
        this._getMaxRatio()).minus(info.borrowed);

    if (xusdAmount.gt(canBorrow)) {
      throw "Not enough to borrow";
    }

    // Now let's mint some xusd.
    blockchain.callWithAuth("token.iost", "issue",
        ["xusd", tx.publisher, xusdAmountStr]);

    // Updates info.
    info.borrowed = new BigNumber(info.borrowed).plus(xusdAmount).toFixed(XUSD_PRECISION, ROUND_DOWN);
    this._setInfo(tx.publisher, info);

    blockchain.receipt(JSON.stringify(["borrow",
        tx.publisher,
        xusdAmountStr,
        info.locked,
        info.borrowed]));
  }

  payBack(xusdAmount) {
    xusdAmount = new BigNumber(xusdAmount);
    const xusdAmountStr = xusdAmount.toFixed(XUSD_PRECISION, ROUND_DOWN);
    xusdAmount = new BigNumber(xusdAmountStr);

    const info = this.getInfo(tx.publisher) || {locked: "0", borrowed: "0"};

    var result;

    if (xusdAmount.gt(info.borrowed)) {
      blockchain.callWithAuth("token.iost", "destroy",
          ["xusd",
           tx.publisher,
           info.borrowed]);
      result = new BigNumber(0);
    } else {
      blockchain.callWithAuth("token.iost", "destroy",
          ["xusd",
           tx.publisher,
           xusdAmountStr]);
      result = new BigNumber(info.borrowed).minus(xusdAmount);
    }

    // Updates info.
    info.borrowed = result.toFixed(XUSD_PRECISION, ROUND_DOWN);
    this._setInfo(tx.publisher, info);

    blockchain.receipt(JSON.stringify(["payBack",
        tx.publisher,
        xusdAmountStr,
        info.locked,
        info.borrowed]));
  }

  startLiquidation(who) {
    const info = this.getInfo(who);

    if (!info) {
      throw "Xigua: invalid user";
    }

    const price = blockchain.call(this._getOracle(), "getAverageGoodPrice", [DEFAULT_MINUTES])[0];

    if (new BigNumber(price).eq(0)) {
      throw "Xigua: oracle error";
    }

    if (new BigNumber(info.locked).times(price).div(this._getMinRatio()).gte(info.borrowed)) {
      throw "Xigua: still good";
    }

    // Pay the borrowed amount for the user.
    blockchain.callWithAuth("token.iost", "destroy",
        ["xusd",
         tx.publisher,
         info.borrowed,
         "start liquidation"]);

    const now = Math.floor(tx.time / 1e9);

    const liquidation = {
      locked: info.locked,
      borrowed: info.borrowed,
      time: now,
      user: who,
      liquidator: tx.publisher,
      finished: 0,
      cancelled: 0
    }

    this._setLiquidation(tx.hash, liquidation);

    // The user doesn't need to pay back if liquidation is not cancelled.
    info.locked = "0";
    info.borrowed = "0";
    this._setInfo(who, info);

    blockchain.receipt(JSON.stringify(["liquidation",
        tx.publisher,
        who,
        price,
        liquidation.locked,
        liquidation.borrowed]));
  }

  finishLiquidation(hash) {
    const liquidation = this.getLiquidation(hash);

    if (liquidation.finished || liquidation.cancelled) {
      throw "Xigua: finish or cancelled";
    }

    if (tx.publisher != liquidation.liquidator) {
      throw "Xigua: not your hash";
    }

    const now = Math.floor(tx.time / 1e9);

    if (now < liquidation.time + 3600 * 24 * 3) {
      throw "Xigua: wait 3 days";
    }

    // Now you are good to go.

    liquidation.finished = 1;
    this._setLiquidation(hash, liquidation);

    const info = this.getInfo(tx.publisher) || {locked: "0", borrowed: "0"};
    info.locked = new BigNumber(info.locked).plus(liquidation.locked).toFixed(IOST_PRECISION, ROUND_DOWN);
    this._setInfo(tx.publisher, info);

    blockchain.receipt(JSON.stringify(["finishLiquidation",
       tx.publisher,
       hash,
       info.locked,
       info.borrowed]));
  }

  cancelLiquidation(hash) {
    this._requireOwner();

    const liquidation = this.getLiquidation(hash);

    if (liquidation.finished || liquidation.cancelled) {
      throw "Xigua: finish or cancelled";
    }

    // Cancel.
    liquidation.cancelled = 1;
    this._setLiquidation(hash, liquidation);

    // Gives xusd back to liquidator.
    blockchain.callWithAuth("token.iost", "issue",
        ["xusd",
         liquidation.liquidator,
         liquidation.borrowed,
         "cancel liquidation"]);

    // Returns locked and borrowed to user.
    const info = this.getInfo(liquidation.user) || {locked: "0", borrowed: "0"};
    info.locked = new BigNumber(info.locked).plus(liquidation.locked).toFixed(IOST_PRECISION, ROUND_DOWN);
    info.borrowed = new BigNumber(info.borrowed).plus(liquidation.borrowed).toFixed(IOST_PRECISION, ROUND_DOWN);
    this._setInfo(liquidation.user, info);

    blockchain.receipt(JSON.stringify(["cancel",
        hash,
        info.locked,
        info.borrowed]));
  }

  // force vost balance to match real balance, by doing this we send vost to extra and feeTo (burner).
  skim() {
    const balance = this._getVOSTBalance();
    const realBalance = new BigNumber(blockchain.call("token.iost", "balanceOf", ["vost", blockchain.contractName()])[0]);

    if (realBalance.gt(balance)) {
      const extraAmount = realBalance.minus(balance).times(0.9);
      const feeAmount = realBalance.minus(balance).times(0.1);

      blockchain.callWithAuth("token.iost", "transfer",
          ["vost",
           blockchain.contractName(),
           this._getExtra() || tx.publisher,
           extraAmount.toFixed(VOST_PRECISION, ROUND_DOWN),
           "skim"]);

      blockchain.callWithAuth("token.iost", "transfer",
          ["vost",
           blockchain.contractName(),
           this._getFeeTo() || tx.publisher,
           feeAmount.toFixed(VOST_PRECISION, ROUND_DOWN),
           "skim"]);
    }
  }
}

module.exports = Bank;
