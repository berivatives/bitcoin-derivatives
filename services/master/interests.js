const redis = require('../../redis'),
    mongo = require('../../mongo'),
    w = require('../../words'),
    co = require('../../constants'),
    {initAccount} = require('../account/initAccount'),
    returnBTC = require('../funding/positionFunding'),
    {setPosition} = require("../../services/trading/position"),
    {wait, publish, getCluster} = require("../../utilities/commons");

async function checkBorrowers(c) {
    while (!mongo[c]) await wait(1000);
    mongo[c].collection(w.users).find().forEach(async function (user) {
        if (!user) return;
        const id = "" + user[w.mongoId];
        let temp = await redis[c].multi([[w.hgetall, id], [w.lrange, id + w.borrowed, 0, -1]])[w.execAsync]();
        const account = temp[0];
        if (!account) return;
        account[w.BTCList] = temp[1];
        initAccount(account, false, false, null, Date.now(), c);
        if (!account[w.BTCList].length) return;
        if (Math.abs(account[w.interests]) < (account[w.free] + account[w.locked])) return;
        const commands = [], individuals = [[], []], balance = [];
        for (let symbol in account[w.positions]) {
            const position = account[w.positions][symbol];
            setPosition(commands, id, account,
                {
                    [w.quantity]: position[w.quantity] * -1,
                    [w.price]: position[w.price],
                    [w.counterPart]: Math.abs(position[w.quantity])
                },
                individuals, symbol, balance, true, symbol + (position[w.quantity] > 0 ? w.sellUsed : w.buyUsed));
            individuals[1].push({id, [w.msg]: {[w.symbol]: symbol, [w.positions]: null}});
        }
        individuals[1].push({id, [w.msg]: {[w.free]: 0, [w.locked]: 0, [w.margin]: 0}});
        await redis[c].multi(commands).execAsync();
        publish({[w.individuals]: individuals[1]}, c);
        returnBTC(account, id, c, true);
        for (let i in balance) {
            balance[i][w.label] = "Return Borrowed Bitcoin " + balance[i][w.label];
            mongo[c].collection(w.balance + getCluster(id)).insertOne(balance[i]);
        }
    }, function (err) {
    });
}

checkBorrowers(co[w.cluster]).then(() => {
    setInterval(async function () {
        await checkBorrowers(co[w.cluster]);
    }, 1000 * 60 * 60 * 24);
});

module.exports = checkBorrowers;