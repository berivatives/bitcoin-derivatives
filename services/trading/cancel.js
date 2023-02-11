const redis = require('../../redis'),
    co = require('../../constants'),
    w = require('../../words'),
    tickers = require('../markets/tickers'),
    openOrder = require("./event"),
    matching = require('./matching'),
    {publish, cancelOrder, increaseBalance, saveOrder} = require("../../utilities/commons"),
    {releaseLock} = require("../../utilities/lock"),
    {getOrderBookCRC} = require("../markets/orderBooks");

module.exports = async (params) => {

    let [id, c, orderId, isCancel, isTriggered, json] = params;

    const order = await redis[c].hgetallAsync(id + orderId);
    const {s} = order;

    const isFunding = s === w.BTC, counterPartUsedLabel = order[w.action] === w.sell ? s + w.sellUsed : s + w.buyUsed;

    const result = await redis[c][w.hmgetAsync](
        id,
        (isFunding ? w.fundingFree : w.free),
        (isFunding ? w.fundingLocked : w.locked),
        counterPartUsedLabel,
        w.margin
    );

    result.forEach((n, i) => result[i] = Number(n));
    let [free, locked, counterPartUsed, margin] = result;
    order[w.quantity] *= 1;
    order[w.fill] *= 1;
    order[w.counterPart] *= 1;
    if (order[w.oco] !== undefined) order[w.oco] *= 1;
    const remainQte = Math.round(order[w.quantity] - order[w.fill]);

    const cs = tickers[s][w.cluster];

    const successFullRemove = await redis[cs].zremAsync([
        s + ((order[w.action] === w.sell ? w.asks : w.bids) + (order[w.execution] === w.STOP ? w.STOP : "")),
        JSON.stringify({
            [w.timestamp]: Number(order[w.timestamp]),
            [w.orderId]: order[w.id],
            c,
            id,
            ...order[w.execution] !== w.STOP ? {
                [w.quantity]: remainQte,
                [w.hidden]: order[w.hidden],
            } : {}
        })
    ]);

    if (order[w.oco] && order[w.fill] <= 0) {
        await redis[cs].zremAsync([
            s + ((order[w.action] === w.sell ? w.asks : w.bids) + w.STOP),
            JSON.stringify({
                [w.timestamp]: Number(order[w.timestamp]),
                [w.orderId]: order[w.id],
                c,
                id
            })
        ])
    }

    const commands = [];

    if (s === w.BTC) {
        if (order[w.fill] <= 0 || (order[w.fill] > 0 && order[w.fill] === order[w.counterPart])) {
            cancelOrder(commands, id, order[w.id]);
            saveInDB(id, c, order);
        } else {
            commands.push([w.hset, id + order[w.id], w.status, w.cancelled]);
        }
    } else if (isCancel || order[w.fill] > 0) {
        cancelOrder(commands, id, order[w.id]);
        saveInDB(id, c, order);
    }

    if (successFullRemove && order[w.execution] !== w.STOP) {
        const orderBookUpdates = [[order[w.price] * 1, w.minus, remainQte, order[w.action] === w.buy ? 0 : 1]];
        const crc = getOrderBookCRC(s, cs, orderBookUpdates);
        if (crc) publish({s, [w.orderBook]: orderBookUpdates, crc}, cs);
    }

    const message = returnFunds(commands, s, id, c, order, {
        free,
        locked,
        [counterPartUsedLabel]: counterPartUsed,
        margin
    }, remainQte, counterPartUsedLabel);

    if (commands.length) await redis[c].multi(commands).execAsync().catch(e => console.log(e));

    if (isCancel) {
        publish(message, c);
        releaseLock(c + id);
        return {error: false, data: w.ORDER_CANCELLED};
    } else {
        if (isTriggered && (order[w.execution] === w.STOP || order[w.oco])) {
            if (order[w.oco] > 0) delete order[w.oco];
            if (order[w.limitPrice] > 0) {
                order[w.execution] = w.GTC;
                order[w.price] = order[w.limitPrice];
            } else {
                order[w.execution] = w.MKT;
            }
        }
        try {
            const open = await openOrder({
                id,
                c,
                json: {...order, ...json},
                symbol: s,
                args: {
                    [w.replace]: true,
                    [w.orderId]: order[w.fill] > 0 ? null : order[w.id],
                    [w.triggered]: isTriggered
                }
            });
            if (json[w.execution] === w.STOP || (!json[w.execution] && order[w.execution] === w.STOP)) {
                return open;
            } else {
                const {error, data} = await matching(open);
                if (error) throw data;
                return {error, data};
            }
        } catch (e) {
            return await failReplace(id, c, order, commands, isTriggered, message);
        }
    }
};

function saveInDB(id, c, order) {
    if (order[w.fill] <= 0) return;
    saveOrder(id, c, order);
}

async function failReplace(id, c, order, commands, isTriggered, message) {
    try {
        commands.length = 0;
        order[w.status] = isTriggered ? w.stopFailed : w.cancelled;
        cancelOrder(commands, id, order[w.id], order[w.status]);
        await redis[c].multi(commands)[w.execAsync]();
        publish(message, c);
        saveOrder(id, c, order);
        return {error: true, data: w.ORDER_CANCELLED_BUT_NOT_REPLACED};
    } catch (e) {

    }
}

function returnFunds(commands, s, id, c, order, account, remainQte, counterPartUsedLabel) {
    let temp;
    if (s === w.BTC) {
        temp = remainQte;
        account[w.fundingFree] = account[w.free];
        account[w.fundingLocked] = account[w.locked];
        if (temp > account[w.fundingLocked]) temp = account[w.fundingLocked];
        increaseBalance(commands, id, account, temp, true);
    } else {
        if (order[w.counterPart] > 0) {
            if (account[counterPartUsedLabel] > 0) {
                if (account[counterPartUsedLabel] > order[w.counterPart]) {
                    commands.push([w.hincrby, id, counterPartUsedLabel, Math.round(order[w.counterPart] * -1)]);
                } else {
                    commands.push([w.hdel, id, counterPartUsedLabel]);
                }
            }
            remainQte -= order[w.counterPart];
        }
        if (remainQte > 0) {
            temp = remainQte * order[w.price] / co.satoshi;
            if (account[w.margin] > 0) {
                if (account[w.margin] >= temp) {
                    commands.push([w.hincrby, id, w.margin, Math.round(temp * -1)]);
                    account[w.margin] -= temp;
                    temp = 0;
                } else {
                    commands.push([w.hincrby, id, w.margin, Math.round(account[w.margin] * -1)]);
                    temp -= account[w.margin];
                    account[w.margin] = 0;
                }
            }
            if (temp > 0) {
                if (temp > account[w.locked]) temp = account[w.locked];
                increaseBalance(commands, id, account, temp, false);
            }
        }
    }
    return {
        [w.orders]: [[id, order[w.id], c]],
        [w.individuals]: [{
            id,
            [w.msg]: s === w.BTC ? {
                [w.fundingFree]: Math.round(account[w.fundingFree]),
                [w.fundingLocked]: Math.round(account[w.fundingLocked])
            } : {
                [w.free]: Math.round(account[w.free]),
                [w.locked]: Math.round(account[w.locked]),
                [w.margin]: Math.round(account[w.margin])
            }
        }]
    };
}