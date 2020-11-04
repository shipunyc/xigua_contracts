// FarmHelper

/*

#totalVote

#vote
[token] => 0

#userToken
[user] => token

#proposal
[proposalId] => ["中文", "en"]

#proposalVoters
[proposalId] => []

#proposalAction
[proposalId + ":" + user] => 1 / -1

#proposalStat
[proposalId] => {
  approval: 0,
  disapproval: 0,
  expiration: time
}


*/

const UNIVERSAL_PRECISION = 12;
const TOKEN_WHITE_LIST = [
['guild_token', 'xlp1603183198330', '0'],
['idt', 'xlp1603943943842', '0'],
['lol', 'xlp1603126828720', '0'],
['metx', 'xlp1603713983453', '0'],
['otbc', 'xlp1603292350826', '0'],
['xusd', 'xusd', '2'],
['zs', 'xlp1603126720057', '1'],
['ppt', 'xlp1603126734507', '2'],
['tpt', 'xlp1603126793694', '1'],
['iost', 'xlp1603017606495', '4'],
['vost', 'xlp1603126749670', '3'],
['xg', 'xlp1603126781817', '25']
];
const ROUND_DOWN = 1;

class FarmHelper {
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

  setFarm(farm) {
    this._requireOwner();
    this._requireUnlocked();

    storage.put("farm", farm);
  }

  _getFarm() {
    return storage.get("farm");
  }

  // The main voting token.
  setMain(main) {
    this._requireOwner();
    this._requireUnlocked();

    storage.put("main", main);
  }

  _getMain() {
    return storage.get("main");
  }

  _setUserToken(who, token) {
    storage.mapPut("userToken", who, token);
  }

  _getUserToken(who) {
    return storage.mapGet("userToken", who) || "";
  }

  _getVote(token) {
    return storage.mapGet("vote", token) || "0";
  }

  _setVote(token, amountStr) {
    storage.mapPut("vote", token, amountStr);
  }

  _addVote(token, amountStr) {
    const currentStr = this._getVote(token);
    this._setVote(token, new BigNumber(currentStr).plus(amountStr).toFixed(UNIVERSAL_PRECISION));
  }

  _minusVote(token, amountStr) {
    const currentStr = this._getVote(token);
    this._setVote(token, new BigNumber(currentStr).minus(amountStr).toFixed(UNIVERSAL_PRECISION));
  }

  _getTotalVote() {
    return storage.get("totalVote") || "0";
  }

  _setTotalVote(amountStr) {
    storage.put("totalVote", amountStr);
  }

  _addTotalVote(amountStr) {
    const currentStr = this._getTotalVote();
    this._setTotalVote(new BigNumber(currentStr).plus(amountStr).toFixed(UNIVERSAL_PRECISION));
  }

  _minusTotalVote(amountStr) {
    const currentStr = this._getTotalVote();
    this._setTotalVote(new BigNumber(currentStr).minus(amountStr).toFixed(UNIVERSAL_PRECISION));
  }

  _setUserAction(proposalId, who, action) {
    const key = proposalId + ":" + who;
    storage.mapPut("proposalAction", key, action.toString());
  }

  _getUserAction(proposalId, who) {
    const key = proposalId + ":" + who;
    return +storage.mapGet("proposalAction", key) || 0;
  }

  _hasUserAction(proposalId, who) {
    const key = proposalId + ":" + who;
    return storage.mapHas("proposalAction", key);
  }

  addProposal(proposalId, textZh, textEn) {
    this._requireOwner();

    storage.mapPut("proposal", proposalId, JSON.stringify([textZh, textEn]));

    const now = Math.floor(tx.time / 1e9);

    storage.mapPut("proposalStat", proposalId, JSON.stringify({
      approval: 0,
      disapproval: 0,
      expiration: now + 3600 * 24
    }));

    storage.mapPut("proposalVoters", proposalId, "[]");
  }

  changeProposal(proposalId, textZh, textEn) {
    this._requireOwner();

    storage.mapPut("proposal", proposalId, JSON.stringify([textZh, textEn]));
  }

  _getAllVoters(proposalId) {
    return JSON.parse(storage.mapGet("proposalVoters", proposalId));
  }

  _addOneVoter(proposalId, who) {
    const list = JSON.parse(storage.mapGet("proposalVoters", proposalId));
    list.push(who);
    storage.mapPut("proposalVoters", proposalId, JSON.stringify(list));
  }

  _getProposalStat(proposalId) {
    return JSON.parse(storage.mapGet("proposalStat", proposalId));
  }

  _setProposalStat(proposalId, stat) {
    storage.mapPut("proposalStat", proposalId, JSON.stringify(stat));
  }

  _actionOnProposal(proposalId, value) {
    if (this._hasUserAction(tx.publisher)) {
      throw "already voted";
    }

    const now = Math.floor(tx.time / 1e9);
    const stat = this._getProposalStat(proposalId);
    if (now > stat.expiration) {
      throw "expired";
    }

    this._addOneVoter(proposalId, tx.publisher);
    this._setUserAction(proposalId, tx.publisher, value);
  }

  approveProposal(proposalId) {
    this._actionOnProposal(proposalId, "1");
  }

  disapproveProposal(proposalId) {
    this._actionOnProposal(proposalId, "-1");
  }

  checkProposal(proposalId) {
    const now = Math.floor(tx.time / 1e9);
    const stat = this._getProposalStat(proposalId);
    if (now > stat.expiration) {
      throw "expired";
    }

    stat.approval = 0;
    stat.disapproval = 0;

    const list = this._getAllVoters(proposalId);
    list.forEach(who => {
      const action = this._getUserAction(proposalId, who);
      const info = JSON.parse(blockchain.call(
          this._getFarm(), "getUserTokenInfo", [who, this._getMain()])[0]);
      if (info && info.amount) {
        if (action * 1 > 0) {
          stat.approval += info.amount * 1;
        } else {
          stat.disapproval += info.amount * 1;
        }
      }
    });

    stat.approval = +stat.approval.toFixed(UNIVERSAL_PRECISION);
    stat.disapproval = +stat.disapproval.toFixed(UNIVERSAL_PRECISION);
    this._setProposalStat(proposalId, stat);
  }

  updatePools() {
    const totalVote = this._getTotalVote();

    TOKEN_WHITE_LIST.forEach(tokenObj => {
      const vote = this._getVote(tokenObj[0]);
      const share = new BigNumber(vote).div(totalVote).times(10);
      if (tokenObj[0] == 'xusd') {
        blockchain.callWithAuth(this._getFarm(), "setPool", ['xusd', 'xusd', share.plus(tokenObj[2]).toFixed(0, ROUND_DOWN), '1']);
      } else {
        blockchain.callWithAuth(this._getFarm(), "setPool", [tokenObj[1], '', share.plus(tokenObj[2]).toFixed(0, ROUND_DOWN), '1']);
      }
    });
  }

  deposit(token, amountStr) {
    if (token != this._getMain()) {
      throw "Xigua: WRONG_TOKEN";
    }

    blockchain.callWithAuth(this._getFarm(), "deposit", [token, amountStr]);

    const userToken = this._getUserToken(tx.publisher);

    if (userToken) {
      this._addVote(userToken, amountStr);
    }

    this._addTotalVote(amountStr);
  }

  withdraw(token) {
    if (token != this._getMain()) {
      throw "Xigua: WRONG_TOKEN";
    }

    const amountStr = blockchain.callWithAuth(this._getFarm(), "withdraw", [token])[0];

    const userToken = this._getUserToken(tx.publisher);

    if (userToken) {
      this._minusVote(userToken, amountStr);
    }

    this._minusTotalVote(amountStr);
  }

  vote(token) {
    const userToken = this._getUserToken(tx.publisher);
    if (token == userToken || !token) {
      return;
    }

    this.unvote(userToken);

    this._setUserToken(tx.publisher, token);

    const info = JSON.parse(blockchain.call(
      this._getFarm(), "getUserTokenInfo", [tx.publisher, this._getMain()])[0]);
    if (info && new BigNumber(info.amount).gt(0)) {
      this._addVote(token, info.amount);
    }
  }

  unvote(token) {
    const userToken = this._getUserToken(tx.publisher);
    if (token != userToken || !token) {
      return;
    }

    this._setUserToken(tx.publisher, "");

    const info = JSON.parse(blockchain.call(
        this._getFarm(), "getUserTokenInfo", [tx.publisher, this._getMain()])[0]);
    if (info && new BigNumber(info.amount).gt(0)) {
      this._minusVote(token, info.amount);
    }
  }
}

module.exports = FarmHelper;
