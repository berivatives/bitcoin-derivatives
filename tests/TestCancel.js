const {strictEqual} = require('assert');
const {clearCache} = require("./clearCache");
const redis = require('../redis');
const w = require('../words');
const {checkOrdersMongo} = require("./utilities");
const {httpGet, query, order, getProp, createUser, orderBookSize, openOrdersSize, closedOrdersSize} = require("./utilities");
const {wait} = require("../utilities/commons");


(async () => {

    let error, data, session, user;

    await clearCache();

    [session, user] = await createUser([w.free, 1e8, w.fundingFree, 1e8]);

    ({data} = await order({q: 1e8, p: 1e8 * 0.06, s: 'BTC', a: 's', e: 'GTC'}, session));
    await openOrdersSize(user, 1);
    strictEqual(await getProp(user, w.fundingFree), 0);
    strictEqual(await getProp(user, w.fundingLocked), 1e8);
    await orderBookSize('BTC' + w.asks, 1);
    await httpGet('/c' + query({[w.id]: data[w.id]}), session);
    strictEqual(await getProp(user, w.fundingFree), 1e8);
    strictEqual(await getProp(user, w.fundingLocked), 0);
    await openOrdersSize(user, 0);
    strictEqual(await getProp(user + data[w.id], w.status, true), w.cancelled);
    await orderBookSize('BTC' + w.asks, 0);
    await checkOrdersMongo(user, 0);

    ({data} = await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: 'GTC'}, session));
    strictEqual(await getProp(user, w.locked), 1e8);
    strictEqual(await getProp(user, w.free), 0);
    await openOrdersSize(user, 1);
    await orderBookSize('ETH' + w.bids, 1);

    await httpGet('/c' + query({[w.id]: data[w.id]}), session);
    strictEqual(await getProp(user, w.locked), 0);
    strictEqual(await getProp(user, w.free), 1e8);
    strictEqual(await getProp(user + data[w.id], w.status, true), w.cancelled);

    await orderBookSize('ETH' + w.bids, 0);

    ({error, data} = await httpGet('/c' + query({[w.id]: data[w.id]}), session));
    strictEqual(error, true);
    strictEqual(data, w.UNKNOWN_ORDER);
    await orderBookSize('ETH' + w.bids, 0);
    await checkOrdersMongo(user, 0);


    /*******cancel partially fill******/
    await clearCache();
    [session, user] = await createUser([w.free, 1e8, w.fundingFree, 1e8]);
    ({data} = await order({q: 1e8, p: 1e8, s: 'ETH', a: 's', e: 'GTC'}, session));
    await order({q: 1e8 * 0.5, p: 1e8, s: 'ETH', a: 'b', e: 'GTC'}, await createUser([w.free, 1e8]));
    strictEqual(await getProp(user, w.free), 0);
    strictEqual(await getProp(user, w.locked), 1e8);
    await orderBookSize('ETH' + w.asks, 1);
    await httpGet('/c' + query({[w.id]: data[w.id]}), session);
    await orderBookSize('ETH' + w.asks, 0);
    strictEqual(await getProp(user, w.locked), 1e8 / 2);
    strictEqual(await getProp(user, w.free), 1e8 / 2);
    strictEqual(await getProp(user + data[w.id], w.status, true), w.cancelled);
    strictEqual(await getProp(user + data[w.id], w.fill), 1e8 / 2);
    await checkOrdersMongo(user, 1);
    /*******cancel partially fill******/


    /*******cancel entirely filled funding******/
    await clearCache();
    [session, user] = await createUser([w.fundingFree, 2e8]);
    ({data} = await order({q: 2e8, p: 1e8 * 0.04, s: 'BTC', a: 's', e: 'GTC'}, session));
    await orderBookSize('BTC' + w.asks, 1);
    await order({q: 1e8, p: 2e8, s: 'ETH', a: 'b', e: 'GTC'}, await createUser([w.free, 1e8]));
    await order({q: 1e8, p: 2e8, s: 'ETH', a: 's', e: 'GTC'}, await createUser([w.free, 1e8]));
    await wait(100);
    await checkOrdersMongo(user, 0);
    await wait(100);
    await orderBookSize('BTC' + w.asks, 0);
    await openOrdersSize(user, 1);
    await closedOrdersSize(user, 0);

    strictEqual(await getProp(user + data[w.id], w.fill), 2e8);
    strictEqual(await getProp(user + data[w.id], w.status, true), w.filled);
    strictEqual(await getProp(user + data[w.id], w.counterPart), 0);

    ({error, data} = await httpGet('/c' + query({[w.id]: data[w.id]}), session));
    strictEqual(error, true);
    strictEqual(data, w.UNKNOWN_ORDER);
    await openOrdersSize(user, 1);
    await closedOrdersSize(user, 0);
    await checkOrdersMongo(user, 0);
    /*******cancel entirely filled funding******/


    /*******cancel partially filled funding******/
    await clearCache();
    [session, user] = await createUser([w.fundingFree, 3e8]);
    ({data} = await order({q: 3e8, p: 1e8 * 0.06, s: 'BTC', a: 's', e: 'GTC'}, session));
    await order({q: 1e8, p: 2e8, s: 'ETH', a: 'b', e: 'GTC'}, await createUser([w.free, 1e8]));
    await order({q: 1e8, p: 2e8, s: 'ETH', a: 's', e: 'GTC'}, await createUser([w.free, 1e8]));
    await orderBookSize('BTC' + w.asks, 1);
    await checkOrdersMongo(user, 0);
    strictEqual(await getProp(user + data[w.id], w.status, true), w.opened);
    strictEqual(await getProp(user + data[w.id], w.fill), 2e8);
    await cancel(session, data[w.id]);
    await orderBookSize('BTC' + w.asks, 0);
    strictEqual(await getProp(user + data[w.id], w.status, true), w.cancelled);
    await checkOrdersMongo(user, 0);
    await closedOrdersSize(user, 0);
    await openOrdersSize(user, 1);
    /*******cancel partially filled funding******/


    /*******cancel partially filled but fully reimbursed******/
    await clearCache();
    [session, user] = await createUser([w.fundingFree, 3e8]);
    ({data} = await order({q: 3e8, p: 1e8 * 0.06, s: 'BTC', a: 's', e: 'GTC'}, session));
    const users = [];
    await order({q: 1e8, p: 2e8, s: 'ETH', a: 'b', e: 'GTC'}, await createUser([w.free, 1e8], users));
    await order({q: 1e8, p: 2e8, s: 'ETH', a: 's', e: 'GTC'}, await createUser([w.free, 1e8], users));
    await wait(100);
    await order({q: 1e8, p: 2e8, s: 'ETH', a: 'b', e: 'GTC'}, users[1]);
    await order({q: 1e8, p: 2e8, s: 'ETH', a: 's', e: 'GTC'}, users[0]);
    await checkOrdersMongo(user, 0);
    strictEqual(await getProp(user + data[w.id], w.fill), 2e8);
    strictEqual(await getProp(user + data[w.id], w.status, true), w.opened);
    await orderBookSize('BTC' + w.asks, 1);
    await cancel(session, data[w.id]);
    await orderBookSize('BTC' + w.asks, 0);
    strictEqual(await getProp(user + data[w.id], w.status, true), w.cancelled);
    strictEqual(await getProp(user + data[w.id], w.counterPart), 2e8);
    strictEqual(await getProp(user + data[w.id], w.quantity), 3e8);
    await openOrdersSize(user, 0);
    strictEqual(await redis[user[0]].lindexAsync(user + w.closedOrders, 0), data[w.id]);
    data = await redis[user[0]].hgetAsync(user, w.fundingFree);
    strictEqual(data > 3e8 && data < 3e8 + 100, true);
    strictEqual(await getProp(user, w.fundingLocked), 0);
    await closedOrdersSize(user, 1);
    await checkOrdersMongo(user, 1);
    /*******cancel partially filled funding******/


    /*******cancel open order which is not in the book anymore******/
    await clearCache();
    [session, user] = await createUser([w.free, 1e8]);
    ({data} = await order({q: 1e8, p: 1e8, s: 'ETH', a: 's', e: 'GTC'}, session));
    await orderBookSize('ETH' + w.asks, 1);
    await openOrdersSize(user, 1);
    await redis[0][w.delAsync]('ETH' + w.asks);
    const o = data;
    ({error} = await httpGet('/c' + query({[w.id]: o[w.id]}), session));
    strictEqual(error, false);
    /*******cancel open order which is not in the book anymore******/


    process.exit(0);
})();

async function cancel(session, id) {
    const {error} = await httpGet('/c' + query({[w.id]: id}), session);
    strictEqual(error, false);
}