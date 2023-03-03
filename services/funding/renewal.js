const redis = require('../../redis'),
    router = require('../../router'),
    {takeLockAsync} = require('../../utilities/lock'),
    w = require('../../words');

router[w.stopRenewal] = async (id, c, json, callback) => {

    await takeLockAsync(c + id + w.stopRenewal);

    if (json[w.id]) return await stopOrderRenewal(id, c, json[w.id], callback);

    const ordersSet = await redis[c].smembersAsync(id + w.openOrders);
    const commands = [];
    let orders = [];

    for (let i in ordersSet) commands.push([w.hmgetAsync, id + ordersSet[i], w.symbol, w.action, w.renew]);
    if (!commands.length) throw w.NO_LEND_ORDER_FOUND;
    orders = await redis[c].multi(commands).execAsync();

    commands.length = 0;

    orders?.forEach((order, i) => {
        if (isRenewable(order)) commands.push([w.hset, id + ordersSet[i], w.renew, w.false]);
    });

    if (!commands.length) throw w.NO_LEND_ORDER_FOUND;
    await redis[c].multi(commands).execAsync();

    callback(false, w.AUTOMATIC_RENEWAL_CANCELLED);
};

async function stopOrderRenewal(id, c, orderId, callback) {
    if (isRenewable(await redis[c][w.hmgetAsync](id + orderId, w.symbol, w.action, w.renew))) {
        await redis[c][w.hsetAsync](id + orderId, w.renew, w.false);
        callback(false, w.AUTOMATIC_RENEWAL_CANCELLED);
    } else {
        throw w.NO_LEND_ORDER_FOUND;
    }
}

function isRenewable(order) {
    return order[0] === w.BTC && order[1] === w.lend && order[2] === w.true;
}