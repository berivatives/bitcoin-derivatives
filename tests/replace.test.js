const {strictEqual} = require('assert');
const w = require('../words');
const redis = require('../redis');
const {checkOrdersMongo} = require("./utilities");
const {orderBookSize} = require("./utilities");
const {clearCache} = require("./clearCache");
const {getProp} = require("./utilities");
const {openOrdersSize, closedOrdersSize} = require("./utilities");
const {clearLock} = require("./utilities");
const {httpGet, query} = require("./utilities");
const {createUser} = require("./utilities");
const {order} = require("./utilities");
const {wait} = require("../utilities/commons");


(async () => {

    let error, data, o, session, user;

    await clearCache();
    [session, user] = await createUser([w.free, 2e8, w.fundingFree, 1e8]);
    ({error, data} = await order({q: 1e8, p: 1e8 * 0.06, s: 'BTC', a: 's', e: 'GTC'}, session));
    strictEqual(error, false);
    await openOrdersSize(user, 1);
    o = data;
    ({error, data} = await httpGet('/r' + query({[w.id]: data[w.id], p: 1e8 * 0.05}), session));
    strictEqual(error, true);
    strictEqual(data, w.UNAUTHORIZED_OPERATION);
    await openOrdersSize(user, 1);

    await clearLock(user, user[0]);
    ({error, data} = await httpGet('/c' + query({[w.id]: o[w.id]}), session));
    strictEqual(error, false);
    strictEqual(data, w.ORDER_CANCELLED);
    await openOrdersSize(user, 0);
    strictEqual(await getProp(user, w.fundingFree), 1e8);
    strictEqual(await getProp(user, w.fundingLocked), 0);

    ({error, data} = await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: 'GTC'}, session));
    strictEqual(error, false);
    await openOrdersSize(user, 1);

    o = data;
    ({error, data} = await httpGet('/r' + query({[w.id]: o[w.id], p: -1}), session));
    strictEqual(error, true);
    strictEqual(data, w.ORDER_CANCELLED_BUT_NOT_REPLACED);
    await openOrdersSize(user, 0);
    await clearLock(user, user[0]);

    ({error, data} = await httpGet('/r' + query({[w.id]: o[w.id]}), session));
    strictEqual(error, true);
    strictEqual(data, w.UNKNOWN_ORDER);
    await clearLock(user, user[0]);

    ({error, data} = await httpGet('/c' + query({[w.id]: o[w.id]}), session));
    strictEqual(error, true);
    strictEqual(data, w.UNKNOWN_ORDER);
    await clearLock(user, user[0]);

    ({error, data} = await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: 'GTC'}, session));
    strictEqual(error, false);
    o = data;
    ({error, data} = await httpGet('/r' + query({[w.id]: o[w.id], p: 1e8 * 1.5}), session));
    strictEqual(error, false, data);
    strictEqual(data[w.id], o[w.id]);
    strictEqual(data[w.quantity], o[w.quantity]);
    strictEqual(data[w.execution], o[w.execution]);
    strictEqual(data[w.price], o[w.price] * 1.5);
    await openOrdersSize(user, 1);
    await orderBookSize('ETH' + w.bids, 1);
    const ob = await redis[0].zrangeAsync('ETH' + w.bids, 0, -1, w.WITHSCORES);
    strictEqual(Number(ob[1]), 1e8 * -1.5);
    strictEqual(await getProp(user, w.free), 1e8 * 0.5);
    strictEqual(await getProp(user, w.locked), 1e8 * 1.5);


    /*******case fail replacing in the matching engine******/
    // supposed to fail because of wash trading but self-trade prevention fixes this test
    // await clearCache();
    // [session, user] = await createUser([w.free, 1e8]);
    // await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session);
    // ({data} = await order({q: 1e8, p: 1e8 * 1.5, s: 'ETH', a: 's', e: w.GTC}, session));
    // const q = query({id: data[w.id], p: 1e8 * 0.9});
    // ({error, data} = await httpGet('/r' + q, session));
    // strictEqual(error, true);
    // strictEqual(data, w.ORDER_CANCELLED_BUT_NOT_REPLACED);
    // await orderBookSize("ETH" + w.bids, 1);
    // await orderBookSize("ETH" + w.asks, 0);
    // await openOrdersSize(user, 1);
    /*******case fail replacing in the matching engine******/


    /*******replace order which is partially filled******/
    await clearCache();
    [session, user] = await createUser([w.free, 1e8, w.fundingFree, 1e8]);
    ({data} = await order({q: 1e8, p: 1e8, s: 'GOLD', a: 's', e: 'GTC'}, session));
    o = data;
    await order({q: 1e8 * 0.5, p: 1e8, s: 'GOLD', a: 'b', e: 'GTC'}, await createUser([w.free, 1e8]));
    strictEqual(await getProp(user, w.free), 0);
    strictEqual(await getProp(user, w.locked), 1e8);
    await orderBookSize('GOLD' + w.asks, 1);
    ({data} = await httpGet('/r' + query({[w.id]: o[w.id], p: 1e8 / 2, q: 1e8 / 2}), session));
    strictEqual(o[w.id] !== data[w.id], true);
    await orderBookSize('GOLD' + w.asks, 1);
    strictEqual(await getProp(user, w.locked), 1e8 * 0.5 + 1e8 / 2 * 0.5);
    strictEqual(await getProp(user, w.free), 1e8 * 0.25);
    strictEqual(await getProp(user + o[w.id], w.status, true), w.cancelled);
    strictEqual(await getProp(user + o[w.id], w.fill), 1e8 / 2);
    strictEqual(await getProp(user + data[w.id], w.status, true), w.opened);
    strictEqual(await getProp(user + data[w.id], w.fill), 0);
    await openOrdersSize(user, 1);
    await closedOrdersSize(user, 1);
    await wait(100);
    await checkOrdersMongo(user, 1);
    /*******replace order which is partially filled******/


    process.exit(0);
})();