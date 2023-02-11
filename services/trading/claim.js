const redis = require('../../redis'),
    mongo = require('../../mongo'),
    router = require('../../router'),
    w = require('../../words'),
    tickers = require('../markets/tickers'),
    {initAccount} = require('../account/initAccount'),
    returnBTC = require('../funding/positionFunding'),
    {setPosition} = require("./position"),
    {publish, getCluster} = require("../../utilities/commons"),
    {takeLockAsync} = require("../../utilities/lock");

router[w.claim] = async (id, c, json, callback) => {

    const symbol = json[w.symbol];

    if (!symbol || !tickers[symbol]) throw w.IMPOSSIBLE_OPERATION;

    await takeLockAsync(c + id);

    let temp = await redis[c].multi([[w.hgetall, id], [w.lrange, id + w.borrowed, 0, -1]])[w.execAsync]();
    const account = temp[0];
    account[w.BTCList] = temp[1];
    if (!account[w.BTCList].length) throw w.IMPOSSIBLE_OPERATION;

    initAccount(account, false, false, symbol, Date.now(), c);

    const position = account[w.positions][symbol];
    const currentPrice = tickers[symbol][w.lastValue];

    if (!position || !currentPrice) throw w.IMPOSSIBLE_OPERATION;

    if (position[w.quantity] > 0) {
        temp = Math.round(position[w.price] * (1 - 1 / account[w.leverage]));
        if (currentPrice > temp) throw w.IMPOSSIBLE_OPERATION;
    } else {
        temp = Math.round(position[w.price] * (1 + 1 / account[w.leverage]));
        if (currentPrice < temp) throw w.IMPOSSIBLE_OPERATION;
    }

    const counterPartUSed = symbol + (position[w.quantity] > 0 ? w.sellUsed : w.buyUsed);

    const commands = [], individuals = [[], []], balance = [];

    setPosition(commands, id, account,
        {
            [w.quantity]: position[w.quantity] * -1,
            [w.price]: temp,
            [w.counterPart]: Math.abs(position[w.quantity])
        },
        individuals, symbol, balance, true, counterPartUSed);

    if (balance[0]) { // if pnl is reduced to zero by the loss there is no msg
        balance[0][w.label] = "Claim " + balance[0][w.label];
    }

    individuals[1].push({
        id,
        [w.msg]: {
            [w.free]: Math.round(account[w.free]),
            [w.locked]: Math.round(account[w.locked]),
            [w.margin]: Math.round(account[w.margin]),
            [w.symbol]: symbol,
            [w.positions]: null
        }
    });

    await redis[c].multi(commands).execAsync();

    publish({[w.individuals]: individuals[1]}, c);

    returnBTC(account, id, c, true);

    mongo[c].collection(w.balance + getCluster(id)).insertOne(balance[0]);

    callback(false, w.POSITION_CLAIMED);
};