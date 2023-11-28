const redis = require('../../redis'),
    mongo = require('../../mongo'),
    {ObjectId} = require('mongodb'),
    co = require('../../constants'),
    w = require('../../words'),
    {publish, saveOrder, getCluster} = require("../../utilities/commons"),
    marketEvent = require("../trading/event"),
    {takeLock, releaseLock} = require("../../utilities/lock"),
    {initAccount} = require("../account/initAccount");

async function payInterests(position, qte, interests) {
    const {id, c} = position;

    if (!id) return;

    const orderId = position[w.order][0];

    const res = await redis[c][w.hmgetAsync](id, w.fundingFree, w.fundingLocked);
    res.forEach((n, i) => res[i] = Number(n));

    let [fundingFree, fundingLocked] = res;

    if (qte > fundingLocked) qte = Math.round(fundingLocked);

    fundingFree += qte;
    fundingLocked -= qte;

    const commands = [];
    commands.push([w.hincrby, id, w.fundingFree, qte, w.fundingLocked, Math.round(qte * -1)]);

    if (interests < 0) {
        commands.push([w.hincrby, id, w.fundingFree, Math.round(interests * -1)]);
        commands.push([w.hincrby, id + orderId, w.fee, interests]);
    }
    commands.push([w.hincrby, id + orderId, w.counterPart, qte]);
    commands.push([w.hmget, id + orderId, w.renew, w.status, w.fill, w.counterPart]);

    const replies = await redis[c].multi(commands)[w.execAsync]();
    const [renew, status, fill, counterPart] = replies[replies.length - 1];

    if (renew === w.true) {
        try {
            await marketEvent({
                id, c,
                json: {
                    [w.action]: w.lend,
                    [w.symbol]: w.BTC,
                    [w.quantity]: qte,
                    [w.price]: position[w.price],
                    [w.execution]: w.GTC,
                    [w.renew]: true,
                },
                symbol: w.BTC,
                args: {}
            });
        } catch (e) {
            console.log(e);
        }
    }


    if ((status === w.cancelled || status === w.filled) && Number(counterPart) >= Number(fill)) {
        commands.length = 0;
        commands.push([w.srem, id + w.openOrders, orderId]);
        commands.push([w.lpush, id + w.closedOrders, orderId]);
        commands.push([w.hgetall, id + orderId]);
        const replies = await redis[c].multi(commands).execAsync();
        saveOrder(id, c, replies[replies.length - 1]);
    }

    publish({
        [w.orders]: [[id, orderId, c]],
        [w.individuals]:
            [{
                id, [w.msg]:
                    {
                        [w.fundingFree]: Math.round(fundingFree),
                        [w.fundingLocked]: Math.round(fundingLocked)
                    }
            }]
    }, c);
}

function balancing(account, id, commands) {
    let exposure = 0;
    for (let s in account[w.positions]) {
        if (account[w.positions][s]) {
            exposure += Math.abs(account[w.positions][s][w.quantity]) * account[w.positions][s][w.price] / co.satoshi;
        }
    }
    if (account[w.toReturn] > 0 && exposure > (account[w.free] + account[w.locked])) {
        const shouldBorrow = exposure - (account[w.free] + account[w.locked]);
        if (shouldBorrow < account[w.BTC][w.quantity]) {
            account[w.toReturn] = account[w.BTC][w.quantity] - shouldBorrow;
        }
        if (account[w.margin] < shouldBorrow) {
            commands.push([w.hincrby, id, w.margin, Math.round(shouldBorrow - account[w.margin])]);
            account[w.margin] += (shouldBorrow - account[w.margin]);
        }
    }
    if (account[w.free] < 0 && account[w.locked] > 0) {
        if (account[w.locked] > account[w.free] * -1) {
            account[w.free] = Math.round(account[w.free] * -1);
            commands.push([w.hincrby, id, w.free, account[w.free], w.locked, Math.round(account[w.free] * -1)]);
            account[w.locked] -= account[w.free];
            account[w.free] = 0;
        } else {
            account[w.locked] = Math.round(account[w.locked]);
            commands.push([w.hincrby, id, w.free, account[w.locked], w.locked, Math.round(account[w.locked] * -1)]);
            account[w.free] += account[w.locked];
            account[w.locked] = 0;
        }
    }
}

async function returnBTC(account, id, c, timeBug) {
    const commands = [], now = timeBug || Date.now();
    let temp, pnl;
    balancing(account, id, commands);
    account[w.toReturn] = Math.round(account[w.toReturn]);
    for (let i = 0; i < account[w.BTCList].length && account[w.toReturn] > 0; i++) {
        temp = account[w.BTCList][i];
        pnl = Math.round(account[w.toReturn] * temp[w.price] / co.satoshi / (3600 * 24000) * (now - temp[w.timestamp]));
        if (pnl > account[w.free] + account[w.locked]) pnl = account[w.free] + account[w.locked];
        await payInterests(
            temp,
            temp[w.quantity] > account[w.toReturn] + 2 ? Math.round(account[w.toReturn]) : Math.round(temp[w.quantity]),
            Math.round(pnl * 0.95 * -1)
        );
        if (temp[w.quantity] > account[w.toReturn] + 2) {
            temp[w.quantity] -= account[w.toReturn];
            account[w.BTC][w.quantity] -= account[w.toReturn];
            commands.push([w.lset, id + w.borrowed, 0, JSON.stringify(temp)]);
            account[w.toReturn] = 0;
        } else {
            commands.push([w.lpop, id + w.borrowed]);
            account[w.toReturn] -= temp[w.quantity];
            account[w.BTC][w.quantity] -= temp[w.quantity];
        }

        const orderId = temp[w.order][1];
        if (pnl !== 0) {
            setTimeout(function () {
                mongo[c].collection(w.orders + getCluster(id)).updateOne({_id: ObjectId(orderId)}, {$inc: {[w.fee]: pnl}});
            }, co.isDev ? 500 : 5000);
        }

        redis[c].hget(id + orderId, w.fee, function (err, fee) {
            if (!err && fee !== null && fee !== undefined) {
                redis[c].hincrby(id + orderId, w.fee, Math.round(pnl));
                publish({[w.orders]: [[id, orderId, c]]}, c);
            }
        });

        account[w.free] -= pnl;
        commands.push([w.hincrby, id, w.free, Math.round(pnl * -1)]);
    }
    if (account[w.BTC] && !account[w.BTC][w.quantity]) account[w.BTC] = null;
    publish({
        [w.individuals]: [{
            id, [w.msg]:
                {
                    [w.symbol]: w.BTC,
                    [w.positions]: account[w.BTC],
                    [w.free]: Math.round(account[w.free])
                }
        }]
    }, c);

    if (timeBug) commands.push([w.lpop, id + w.errorBTC]);

    await redis[c].multi(commands).execAsync().catch(e => console.log(e));
    releaseLock(c + id + w.funding);
}

const stopLending = function (account, id, c, skipInit, timeBug, retry) {
    if (!account[w.toReturn]) return;
    takeLock(c + id + w.funding, async function (result) {
        if (result) {
            try {
                if (!skipInit) {
                    const toReturn = account[w.toReturn];
                    let temp = await redis[c].multi([[w.hgetall, id], [w.lrange, id + w.borrowed, 0, -1]])[w.execAsync]();
                    account = temp[0];
                    account[w.BTCList] = temp[1];
                    initAccount(account, false, false, null, Date.now(), c);
                    account[w.toReturn] = toReturn;
                }
                await returnBTC(account, id, c, timeBug);
            } catch (e) {
                console.log(e);
                redis[c].lpush(id + w.errorBTC, JSON.stringify([account[w.toReturn], Date.now()]));
            }
        } else if (!timeBug) {
            if (retry !== false) {
                setTimeout(stopLending, 5000, account, id, c, skipInit, timeBug, false);
            } else {
                redis[c].lpush(id + w.errorBTC, JSON.stringify([account[w.toReturn], Date.now()]));
            }
        }
    });
};

module.exports = stopLending;
