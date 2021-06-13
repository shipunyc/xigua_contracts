// Oracle

/*

// tid tracks time back to 30 days.
tid = (secondsSinceEpoch / 60) % (60 * 24 * 30);

# binance_price
tid => number

# huobi_price
tid => number

# okex_price
tid => number

3 independent bots reports prices of the 3 exchanges independently,
and we take the 2 with the minimum diffs as the oracle price.

Currently okex bot is not in use yet because of:
https://www.coindesk.com/okex-suspends-withdrawals

*/

const PRICE_PRECISION = 6;
const TOTAL_MINUTES = 60 * 24 * 10;  // 10 days.
const TIME_LOCK_DURATION = 12 * 3600; // 12 hours

class Oracle {

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

  setBot(exchange, bot) {
    this._requireOwner();

    if (['binance', 'huobi', 'okex'].indexOf(exchange) < 0) {
      throw "exchange not supported";
    }

    storage.mapPut("bot", exchange, bot);
  }

  _getBot(exchange) {
    return storage.mapGet("bot", exchange);
  }

  setPrice(exchange, price) {
    const bot = this._getBot(exchange);
    if (!blockchain.requireAuth(bot, "active")) {
      throw "invalid bot";
    }

    const now = Math.floor(tx.time / 1e9);
    const tid = Math.floor(now / 60) % TOTAL_MINUTES;

    storage.mapPut(exchange + "_price", tid.toString(), (+price).toFixed(6));

    return tid;
  }

  getPrice(exchange, tid) {
    if (['binance', 'huobi', 'okex'].indexOf(exchange) < 0) {
      throw "exchange not supported";
    }

    return +storage.mapGet(exchange + "_price", tid.toString()) || 0;
  }

  getGoodPrice(tid) {
    const binancePrice = +this.getPrice("binance", tid);
    const huobiPrice = +this.getPrice("huobi", tid);
    const okexPrice = +this.getPrice("okex", tid);

    const array = [];

    if (binancePrice) array.push(binancePrice);
    if (huobiPrice) array.push(huobiPrice);
    if (okexPrice) array.push(okexPrice);

    if (array.length == 0) return 0;
    if (array.length == 1) return array[0];
    if (array.length == 2) return +((array[0] + array[1]) / 2).toFixed(6);
    if (array.length == 3) {
      array.sort();
      if (array[1] - array[0] < array[2] - array[1]) {
        return +((array[0] + array[1]) / 2).toFixed(PRICE_PRECISION);
      } else {
        return +((array[1] + array[2]) / 2).toFixed(PRICE_PRECISION);
      }
    }
  }

  getAverageGoodPrice(minutes) {
    const now = Math.floor(tx.time / 1e9);
    const tid = Math.floor(now / 60) % TOTAL_MINUTES;

    var sum = new BigNumber(0);
    var count = 0;
    for (let i = 0; i < minutes; ++i) {
      const currentTid = (tid + TOTAL_MINUTES - i) % TOTAL_MINUTES;
      const currentPrice = +this.getGoodPrice(currentTid)
      if (currentPrice) {
        sum = sum.plus(this.getGoodPrice(currentTid));
        ++count;
      }
    }

    if (!count) {
      throw "no price";
    }

    return sum.div(count).toFixed(PRICE_PRECISION);
  }
}

module.exports = Oracle;
