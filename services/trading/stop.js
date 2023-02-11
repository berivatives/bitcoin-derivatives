const redis = require('../../redis'),
    {ObjectId} = require('mongodb'),
    w = require('../../words'),
    co = require('../../constants'),
    router = require('../../router'),
    tickers = require('../markets/tickers'),
    {takeLock, releaseLock} = require('../../utilities/lock'),
    {hasEnoughFunds, oneLineOrder, publish, isBadPrice} = require("../../utilities/commons");

exports.stopOrder = async (id, c, json, account, symbol, qty, price, sell, counterPartUsedLabel, reduceOnly, postOnly, hidden, args) => {

    if (tickers[symbol][w.lastValue] > 0) {
        if ((sell && price > tickers[symbol][w.lastValue]) || (!sell && price < tickers[symbol][w.lastValue])) throw w.AUTO_TRIGGER_STOP_ORDER;
    }

    const now = Date.now(), commands = [],
        order = {
            [w.id]: !args[w.replace] ? ObjectId().toString() : args[w.orderId],
            [w.timestamp]: now,
            [w.action]: json[w.action],
            [w.symbol]: symbol,
            [w.quantity]: qty,
            [w.price]: price,
            [w.execution]: json[w.execution],
            [w.status]: w.opened,
            [w.fill]: 0,
            [w.fee]: 0,
            [w.post]: postOnly,
            [w.hidden]: hidden,
            [w.reduce]: reduceOnly,
            [w.counterPart]: 0
        };

    if (json[w.limitPrice] !== undefined && json[w.limitPrice] !== null) {
        const limitPrice = Math.round(String(json[w.limitPrice]) * 1);
        if (isBadPrice(limitPrice)) throw w.BAD_PRICE;
        order[w.limitPrice] = limitPrice;
    }

    let temp = order[w.quantity];

    if (account[w.size] && (account[w.size] - account[counterPartUsedLabel]) > 0) {
        if (temp > (account[w.size] - account[counterPartUsedLabel])) {
            temp -= (account[w.size] - account[counterPartUsedLabel]);
            order[w.counterPart] = Math.round(account[w.size] - account[counterPartUsedLabel]);
            commands.push([w.hincrby, id, counterPartUsedLabel, Math.round(order[w.counterPart])]);
        } else {
            commands.push([w.hincrby, id, counterPartUsedLabel, temp]);
            order[w.counterPart] = temp;
            temp = 0;
        }
    }

    temp *= order[w.price] / co.satoshi;

    if (!hasEnoughFunds(id, account, commands, temp)) throw w.INSUFFICIENT_BALANCE;

    await redis[tickers[symbol][w.cluster]][w.zaddAsync](symbol + (order[w.action] === w.sell ? w.asks : w.bids) + w.STOP,
        order.p,
        JSON.stringify({
            [w.timestamp]: order[w.timestamp],
            [w.orderId]: order[w.id],
            [w.cluster]: c,
            [w.id]: id
        }));

    commands.push([w.hmset, id + order[w.id], ...oneLineOrder(order)]);
    commands.push([w.sadd, id + w.openOrders, order[w.id]]);
    commands.push([w.hincrby, id, w.counter + w.order, 1]);

    await redis[c].multi(commands).execAsync();

    publish({
        [w.individuals]: [{
            id,
            [w.msg]: {
                [w.free]: Math.round(account[w.free]),
                [w.locked]: Math.round(account[w.locked]),
                [w.margin]: Math.round(account[w.margin])
            }
        }], [w.orders]: [[id, order[w.id], c]]
    }, c);

    releaseLock(c + id);
    return {error: false, data: order};
};

exports.triggerStops = function (stops) {
    for (let i in stops) {
        const stop = JSON.parse(stops[i]);
        takeLock(stop[w.cluster] + stop[w.id] + stop[w.orderId], function (result) {
            if (!result) return;
            router[w.replace](
                stop[w.id], stop[w.cluster], {
                    [w.message]: w.replace,
                    [w.id]: stop[w.orderId]
                }, function () {
                }, {[w.triggered]: true}
            ).catch(async (error) => {
                // check only unknown error otherwise it just failed to take lock so the stop is still waiting to be triggered
                if (!w[error]) console.log(error);
            });
        }, 5);
    }
};