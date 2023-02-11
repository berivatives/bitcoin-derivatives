const net = require('net'),
    {ObjectId} = require('mongodb'),
    tickers = require('../markets/tickers'),
    redis = require('../../redis'),
    crypto = require('crypto'),
    router = require('../../router'),
    w = require('../../words'),
    co = require('../../constants'),
    {extractField, basicBalanceCheck} = require('./utilities'),
    {takeLockAsync, extendLock} = require('../../utilities/lock'),
    stop = require("./stop"),
    sockets = {},
    triggers = {};

router[w.open] = async (id, c, json, callback, args) => {
    const symbol = json[w.symbol];
    if (!tickers[symbol]) throw w.IMPOSSIBLE_OPERATION;
    await initSocket(symbol);
    await openOrder({id, c, json, symbol, args, callback});
};

router[w.cancel] = async (id, c, json, callback, args) => {

    await takeLockAsync(c + id);

    const [symbol, status] = await redis[c].hmgetAsync(id + json[w.id], w.symbol, w.status);
    const isCancel = json[w.message] === w.cancel || args.url === w.cancel;

    if (symbol === w.BTC && !isCancel) throw w.UNAUTHORIZED_OPERATION;
    if (status !== w.opened) throw w.UNKNOWN_ORDER;

    await initSocket(symbol);

    triggers[id + json[w.id]] = (error, data) => callback(error, data);

    await redis[w.minus + tickers[symbol][w.cluster]][w.lpushAsync](symbol + w.orderBook, JSON.stringify([
        id, c, json[w.id], isCancel, args[w.triggered],
        isCancel ? {} : {
            [w.price]: json[w.price],
            [w.quantity]: json[w.quantity],
            [w.execution]: json[w.execution],
            [w.post]: json[w.post],
            [w.hidden]: json[w.hidden],
            [w.reduce]: json[w.reduce],
            [w.oco]: json[w.oco],
        },
        sockets[symbol][w.socketId], json[w.message] || args[w.url]
    ]));
};

router[w.replace] = router[w.cancel];

async function initSocket(symbol) {
    if (!sockets[symbol]) {
        await connectClient(symbol, getMatchingHost(tickers[symbol][w.cluster]), 8001);
    }
}

function getMatchingHost(c) {
    for (let i in co.clusters) {
        if (co.clusters[i] === String(c)) return co.machines[i][0];
    }
}

const openOrder = async function (params) {

    const {id, c, json, symbol, args, callback} = params;

    const orderId = args[w.orderId] || ObjectId().toString();

    const isFunding = symbol === w.BTC;

    if (!args[w.replace]) {
        await takeLockAsync(c + id + (args[w.borrow] ? w.borrow : ""));
    } else {
        extendLock(c + id);
    }

    if (!json[w.action]) throw w.IMPOSSIBLE_OPERATION;

    const sell = json[w.action] === w.sell;

    if (!sell && isFunding && !args[w.borrow]) throw w.IMPOSSIBLE_OPERATION;

    let {execution, qty, price, postOnly, hide, reduceOnly, redisPrice, total, myId, oco} = extractField(json, sell, symbol);

    const counterPartUsedTaker = symbol + (sell ? w.sellUsed : w.buyUsed);

    let result = await redis[c][w.hmgetAsync](id, (isFunding ? w.fundingFree : w.free), (isFunding ? w.fundingLocked : w.locked), w.counter + w.order, w.maxOrders, counterPartUsedTaker, w.margin, w.positions + symbol, w.verification + w.status);
    result.forEach((n, i) => {
        if (i < 6) result[i] = Number(n);
    });

    let [free, locked, ordersCounter, maxOrders, counterPartUsed, margin, position, verification] = result;
    position = JSON.parse(position);

    if (ordersCounter > (maxOrders || 10000)) throw w.DAILY_LIMIT_REACHED;

    total = basicBalanceCheck(free, locked, margin, position, sell, total, qty, price, execution, symbol, counterPartUsed, verification);

    if (execution === w.STOP) {
        const account = {free, locked, margin, [counterPartUsedTaker]: counterPartUsed};
        if (position) {
            if ((sell && position[w.quantity] > 0) || (!sell && position[w.quantity] < 0)) {
                account[w.size] = Math.abs(position[w.quantity]);
            } else {
                account[w.size] = 0;
            }
        }
        const res = await stop.stopOrder(
            id, c, json,
            account, symbol,
            qty, price, sell, counterPartUsedTaker, reduceOnly, postOnly, hide, args
        );
        callback && callback(res.error, res.data);
        return res;
    }

    const matchingMessage = [
        id, c, orderId, symbol, execution, qty, sell,
        price, postOnly, hide, reduceOnly,
        redisPrice, total, myId, oco
    ];

    if (args[w.replace]) {
        matchingMessage.push(args);
        return matchingMessage;
    }

    triggers[id + orderId] = (error, data) => callback && callback(error, data);

    if (!sockets[symbol]) await initSocket(symbol);

    await redis[w.minus + tickers[symbol][w.cluster]][w.lpushAsync](
        symbol + w.orderBook,
        JSON.stringify(
            [...matchingMessage, isFunding && !sell ? args : {}, sockets[symbol][w.socketId], w.open]
        )
    );

};

function connectClient(symbol, host, port) {
    return new Promise(resolve => {
        const socket = new net.Socket();

        sockets[symbol] = socket;

        socket.connect({host, port});

        socket.on('connect', function () {
            const id = crypto.randomBytes(8).toString("hex");
            socket[w.socketId] = id;
            socket.write(id);
            resolve();
        });

        socket.on('data', async function (msg) {
            try {
                // console.log(msg.toString());
                msg.toString().split('|').forEach(message => {
                    if (!message.length) return;
                    const {id, error, data} = JSON.parse(message);
                    triggers[id](error, data);
                });
            } catch (e) {
                console.log(e);
            }
        });

        socket.on('close', function () {
            delete sockets[symbol];
        });

        socket.on('error', function (err) {
        });
    });
}

module.exports = openOrder;