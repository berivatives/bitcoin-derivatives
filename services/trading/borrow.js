const redis = require('../../redis'),
    {ObjectId} = require('mongodb'),
    co = require('../../constants'),
    w = require('../../words'),
    tickers = require('../markets/tickers'),
    {fixed, oneLineOrder, publish, wait, saveOrder} = require('../../utilities/commons'),
    marketEvent = require("./event"),
    returnBTC = require("../funding/positionFunding"),
    {initAccount} = require("../account/initAccount");

exports.borrowBitcoin = function (account) {
    marketEvent({
        [w.id]: account[w.id],
        [w.cluster]: account[w.cluster],
        json: {[w.action]: w.borrow, [w.symbol]: w.BTC, [w.quantity]: account[w.toBorrow], [w.execution]: w.MKT},
        symbol: w.BTC,
        args: {[w.borrow]: true},
        callback: async function (error, data) {
            if (error) console.log("borrow", error, account[w.id], data);
            if (co.isDev && account[w.id] === "0wait") await wait(1000);
            if (typeof data === 'object' && data[w.status] !== w.filled) {
                // noinspection ES6MissingAwait
                internalBorrow(account, account[w.toBorrow] - data[w.fill]);
            } else if (error && typeof data !== 'object') {
                // noinspection ES6MissingAwait
                internalBorrow(account, account[w.toBorrow], data);
            }
        }
    }).catch(e => {
        console.log(e);
        if (!w[e]) console.log(e);
        // noinspection JSIgnoredPromiseFromCall
        internalBorrow(account, account[w.toBorrow], e);
    });
};

const mustReturnBitcoin = function (id, c, account, BTCList) {
    account[w.BTCList] = BTCList;
    initAccount(account, false, false, null, Date.now(), c);
    if (account[w.exposure] < account[w.BTC][w.quantity]) {
        account[w.toReturn] = account[w.BTC][w.quantity] - account[w.exposure];
        returnBTC(account, id, c, true);
    }
    return account;
};

exports.mustReturnBitcoin = mustReturnBitcoin;

async function internalBorrow(account, amount, why) {
    if (!amount) return;
    const now = Date.now(), {id, c} = account;
    const order = {
        [w.id]: ObjectId().toString(),
        [w.timestamp]: now,
        [w.action]: w.borrow,
        [w.symbol]: w.BTC,
        [w.quantity]: amount,
        [w.price]: tickers[w.BTC][w.lastValue] || 0.06 * co.satoshi,
        [w.execution]: w.MKT,
        [w.status]: w.filled,
        [w.fill]: amount,
        [w.fee]: 0,
        [w.post]: w.false,
        [w.hidden]: w.false,
        [w.reduce]: w.false,
        [w.counterPart]: 0,
        [w.myId]: "" + why
    };
    order[String(now)] = fixed(order[w.fill]) + w.at + fixed(order[w.price]);
    if (!account[w.BTC]) {
        account[w.BTC] = {[w.quantity]: account[w.toBorrow], [w.price]: order[w.price], [w.pnl]: 0};
    } else {
        account[w.BTC][w.timestamp] = (account[w.BTC][w.quantity] * account[w.BTC][w.timestamp] + account[w.toBorrow] * now) / (account[w.BTC][w.quantity] + account[w.toBorrow]);
        account[w.BTC][w.price] = (account[w.BTC][w.quantity] * account[w.BTC][w.price] + account[w.toBorrow] * order[w.price]) / (account[w.BTC][w.quantity] + account[w.toBorrow]);
        account[w.BTC][w.quantity] += account[w.toBorrow];
    }
    const reply = await redis[c].multi([
        [w.hmset, id + order[w.id], ...oneLineOrder(order)],
        [w.lpush, id + w.closedOrders, order[w.id]],
        [w.rpush, id + w.borrowed, JSON.stringify({
            [w.timestamp]: order[w.timestamp],
            [w.quantity]: order[w.quantity],
            [w.price]: order[w.price],
            [w.order]: [null, order[w.id]]
        })],
        [w.hgetall, id],
        [w.lrange, id + w.borrowed, 0, -1]
    ])[w.execAsync]();

    publish({
        [w.orders]: [[id, order[w.id], c]],
        [w.individuals]: [{id, [w.msg]: {[w.symbol]: w.BTC, [w.positions]: account[w.BTC]}}]
    }, c);
    saveOrder(id, c, order, true);
    mustReturnBitcoin(id, c, reply[reply.length - 2], reply[reply.length - 1]);
}