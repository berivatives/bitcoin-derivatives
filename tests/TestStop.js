const {strictEqual} = require('assert');
const w = require('../words');
const {clearCache} = require("./clearCache");
const redis = require("../redis");
const mongo = require("../mongo");
const {ObjectId} = require("mongodb");
const {checkBalance} = require("./utilities");
const {order, getProp, clearLock, createUser, checkDuplicates, orderBookSize, openOrdersSize} = require("./utilities");
const {wait, getCluster} = require("../utilities/commons");

let session, user, session2, user2;

(async () => {

    let error, data;

    await clearCache();

    [session, user] = await createUser([w.free, 2e8]);
    ({error} = await order({q: 2e8, p: 1e8, s: 'ETH', a: 'b', e: 'GTC'}, session));
    strictEqual(error, false);
    strictEqual(await getProp(user, w.free), 0);
    strictEqual(await getProp(user, w.locked), 2e8);
    strictEqual(await getProp(user, w.margin), 0);

    [session2, user2] = await createUser([w.free, 2e8]);
    ({error} = await order({q: 1e8 / 2, p: 1e8, s: 'ETH', a: 's', e: 'GTC'}, session2));
    strictEqual(error, false);
    strictEqual(await getProp(user2, w.free), 2e8 - 1e8 / 2);
    strictEqual(await getProp(user2, w.locked), 1e8 / 2);
    strictEqual(await getProp(user2, w.margin), 0);

    ({data, error} = await order({q: 1e8 / 2, p: 1e8 + 1, s: 'ETH', a: 's', e: w.STOP}, session2));
    strictEqual(error, true);
    strictEqual(data, w.AUTO_TRIGGER_STOP_ORDER);
    await clearLock(user2, user2[0]);

    ({data, error} = await order({q: 1e8 / 2, p: 1e8 - 1, s: 'ETH', a: 'b', e: w.STOP}, session2));
    strictEqual(error, true);
    strictEqual(data, w.AUTO_TRIGGER_STOP_ORDER);
    await clearLock(user2, user2[0]);

    ({error, data} = await order({q: 1e8 / 2, p: 1e8, s: 'ETH', a: 's', e: w.STOP}, session2));
    strictEqual(error, false);
    strictEqual(await redis[user2[0]]['sismemberAsync'](user2 + w.openOrders, data[w.id]), 1);
    strictEqual((await redis[0].zrangeAsync("ETH" + w.asks + w.STOP, 0, -1))[0], JSON.stringify({
        [w.timestamp]: data[w.timestamp],
        [w.orderId]: data[w.id],
        [w.cluster]: user2[0],
        [w.id]: user2
    }));
    await orderBookSize("ETH" + w.asks + w.STOP, 1);
    await orderBookSize("ETH" + w.bids + w.STOP, 0);
    strictEqual(data[w.id], (await redis[user2[0]].hgetallAsync(user2 + data[w.id]))[w.id]);
    strictEqual(await getProp(user2, w.free), 1e8);
    strictEqual(await getProp(user2, w.locked), 1e8);
    strictEqual(await getProp(user2, w.margin), 0);

    const [session3] = await createUser([w.free, 2e8]);
    ({error} = await order({q: 1e8 / 2, s: 'ETH', a: 's', e: w.MKT}, session3));
    strictEqual(error, false);

    await checkStopState(data, user2);

    await order({q: 1e8 / 2, p: 1e8, s: 'ETH', a: 's', e: 'GTC'}, session2);
    strictEqual(error, false);

    await clearCache();
    [session, user] = await createUser([w.free, 2e8]);
    ({error, data} = await order({q: 1e8 / 2, p: 1e8, s: 'ETH', a: 's', e: w.STOP}, session));
    strictEqual(error, false);
    await orderBookSize("ETH" + w.asks + w.STOP, 1);
    await triggerStop('ETH', 1e8);
    await checkStopState(data, user, w.stopFailed);

    await failStop(); // case not enough funds so fails in the basics checks before entering the matching engine
    await failStop(10e8); // case not enough funds to borrow so fails in the matching engine


    /*****Stop limit*****/
    for (const a of [w.sell, w.buy]) {
        await clearCache();
        [session, user] = await createUser([w.free, 1e8]);
        ({data} = await order({q: 1e8, p: 1e8, s: 'ETH', a, e: w.STOP, lp: 1e8 / 2}, session));
        strictEqual(data[w.limitPrice], 1e8 / 2);
        strictEqual(data[w.execution], w.STOP);
        strictEqual(await getProp(user, w.free), 0);
        strictEqual(await getProp(user, w.locked), 1e8);
        await orderBookSize("ETH" + w.asks + w.STOP, a === w.sell ? 1 : 0);
        await orderBookSize("ETH" + w.bids + w.STOP, a === w.sell ? 0 : 1);
        await triggerStop('ETH', 1e8);
        await wait(10);
        await orderBookSize("ETH" + w.bids + w.STOP, 0);
        await orderBookSize("ETH" + w.asks + w.STOP, 0);
        await orderBookSize("ETH" + w.asks, a === w.sell ? 1 : 0);
        await orderBookSize("ETH" + w.bids, a === w.sell ? 0 : 1);
        strictEqual(await getProp(user + data[w.id], w.status, true), w.opened);
        strictEqual(await getProp(user + data[w.id], w.execution, true), w.GTC);
        strictEqual(await getProp(user + data[w.id], w.action, true), a);
        strictEqual(await getProp(user, w.free), 1e8 / 2);
        strictEqual(await getProp(user, w.locked), 1e8 / 2);
    }
    /*****Stop limit*****/


    /*****Position is closed, stop failure due to reduce only*****/
    for (const {a, a1} of [{a: 'b', a1: 's'}, {a: 's', a1: 'b'}]) {
        await clearCache();
        [session, user] = await createUser([w.free, 10e8]);
        await order({q: 1e8, p: 1e8, s: 'ETH', a: a, e: w.GTC}, session);
        await order({q: 1e8, p: 1e8, s: 'ETH', a: a1, e: w.GTC}, await createUser([w.free, 1e8]));
        await checkBalance(user, w.free, 9e8, w.locked, 1e8, w.margin, 0);
        await order({q: 1e8, p: 1e8, s: 'ETH', a: a1, e: w.GTC}, session);
        const sp = a === w.buy ? (1e8 * 0.8) : 1e8 * 1.5;
        ({data} = await order({q: 1e8, p: sp, s: 'ETH', a: a1, e: w.STOP, r: true}, session));
        await order({q: 1e8, s: 'ETH', a: a, e: w.MKT}, await createUser([w.free, 1e8]));
        await order({q: 10e8, p: sp, s: 'ETH', a: a, e: w.GTC}, await createUser([w.free, 100e8]));
        await order({q: 1e8 / 2, p: sp, s: 'ETH', a: a1, e: w.GTC}, await createUser([w.free, 1e8]));
        await wait(100);
        strictEqual(await getProp(user + data[w.id], w.status, true), w.stopFailed);
        await checkBalance(user, w.free, 10e8, w.locked, 0, w.margin, 0);
    }
    /*****Position is closed, stop triggered cancel due to reduce only*****/

    process.exit(0);
})();

async function triggerStop(s, p) {
    await order({q: 1e8, p, s, a: 'b', e: w.GTC}, await createUser([w.free, 2e8]));
    await order({q: 1e8, p, s, a: 's', e: w.GTC}, await createUser([w.free, 2e8]));
}

async function failStop(p) {
    await clearCache();
    [session, user] = await createUser([w.free, 5e8]);
    await order({q: 1e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session);
    strictEqual(await getProp(user, w.free), 4e8);
    strictEqual(await getProp(user, w.locked), 1e8);
    strictEqual(await getProp(user, w.margin), 0);

    [session2, user2] = await createUser([w.free, 1e8]);
    await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session2);
    const {data} = await order({q: 1e8, p: p || (100e8 - 1), s: 'ETH', a: 'b', e: w.STOP}, session);
    strictEqual(data[w.counterPart], 1e8);
    await orderBookSize("ETH" + w.bids + w.STOP, 1);
    await orderBookSize("ETH" + w.asks + w.STOP, 0);
    await openOrdersSize(user, 1);

    await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session);
    await order({q: 1e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session2);
    strictEqual(await getProp(user, w.free), 5e8);
    strictEqual(await getProp(user, w.locked), 0);
    strictEqual(await getProp(user, w.margin), 0);
    await openOrdersSize(user, 1);

    await order({q: 1e8, p: p || (100e8 - 1), s: 'ETH', a: 's', e: w.GTC}, await createUser([w.free, 100e8]));
    await order({q: 1e8 / 10, p: p || (100e8 - 1), s: 'ETH', a: 'b', e: w.GTC}, await createUser([w.free, 100e8]));

    await checkStopState(data, user, w.stopFailed);
}

async function checkStopState(data, user, st) {
    await wait(200);
    const o = await redis[user[0]].hgetallAsync(user + data[w.id]);
    strictEqual(data[w.id], o[w.id]);
    strictEqual(o[w.status], st || w.filled);
    strictEqual(o[w.execution], !st ? w.MKT : w.STOP);
    await orderBookSize("ETH" + w.asks + w.STOP, 0);
    await openOrdersSize(user, 0);
    const orders = await mongo[user[0]].collection(w.orders + getCluster(user)).find({[w.mongoId]: ObjectId(o[w.id])}).toArray();
    await checkDuplicates(user);
    strictEqual(orders.length, 1);
    strictEqual(orders[0][w.status], st || w.filled);
}