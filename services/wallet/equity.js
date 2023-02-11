const returnBTC = require('../funding/positionFunding'),
    w = require('../../words'),
    redis = require('../../redis');

module.exports = async (id, c, account) => {

    if (!account[w.BTCList].length) return;

    const commands = [];

    if (account[w.BTC][w.quantity] > account[w.free]) {
        account[w.toReturn] = account[w.free];
    } else {
        account[w.toReturn] = account[w.BTC][w.quantity];
    }

    returnBTC(account, id, c, true);

    if (account[w.margin] > 0) {
        if (account[w.free] > account[w.margin]) {
            reduceEquity(commands, id, account[w.margin]);
            account[w.free] -= account[w.margin];
            account[w.locked] += account[w.margin];
            account[w.margin] = 0;
        } else {
            reduceEquity(commands, id, account[w.free]);
            account[w.locked] += account[w.free];
            account[w.margin] -= account[w.free];
            account[w.free] = 0;
        }
    }

    if (commands.length) await redis[c].multi(commands)[w.execAsync]();
};

function reduceEquity(commands, id, amount) {
    commands.push([w.hincrby, id, w.free, Math.round(amount * -1), w.locked, Math.round(amount), w.margin, Math.round(amount * -1)]);
}
