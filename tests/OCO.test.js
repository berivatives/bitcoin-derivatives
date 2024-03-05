const {clearCache} = require("./clearCache");
const {strictEqual} = require('assert');
const w = require('../words');
const {httpGet, query, createUser, order, clearLock} = require("./utilities");
const redis = require("../redis");
const {checkBalance} = require("./utilities");
const {closedOrdersSize} = require("./utilities");
const {orderBookSize} = require("./utilities");
const {getProp} = require("./utilities");
const {wait} = require("../utilities/commons");

let error, data;
const s = 'GOLD';

(async () => {
    await clearCache();
    const [session, user] = await createUser([w.free, 1e8]);

    ({data, error} = await order({q: 1e8, p: 1e8, s, a: 's', e: 'MKT', oco: 0}, session));
    strictEqual(error, true);
    strictEqual(data, w.IMPOSSIBLE_OPERATION);
    await clearLock(user, user[0]);

    ({data, error} = await order({q: 1e8, p: 1e8, s, a: 's', e: 'GTC', oco: 0}, session));
    strictEqual(error, true);
    strictEqual(data, w.BAD_PRICE);
    await clearLock(user, user[0]);

    ({data, error} = await order({q: 1e8, p: 1e8, s, a: 's', e: 'GTC', oco: 2e8}, session));
    strictEqual(error, true);
    strictEqual(data, w.AUTO_TRIGGER_STOP_ORDER);
    await clearLock(user, user[0]);

    ({data, error} = await order({q: 1e8, p: 1e8, s, a: 'b', e: 'GTC', oco: 1e8 / 2}, session));
    strictEqual(error, true);
    strictEqual(data, w.AUTO_TRIGGER_STOP_ORDER);
    await clearLock(user, user[0]);

    ({data, error} = await order({q: 1e8, p: 1e8, s, a: 's', e: 'GTC', oco: 1e8 / 2}, session));
    strictEqual(error, false);
    strictEqual(data[w.oco], 1e8 / 2);

    await orderBookSize(s + w.bids, 0);
    await orderBookSize(s + w.asks, 1);
    strictEqual((await redis[0].zrangeAsync(s + w.asks, 0, -1))[0], JSON.stringify({
        [w.timestamp]: data[w.timestamp],
        [w.orderId]: data[w.id],
        [w.cluster]: user[0],
        [w.id]: user,
        [w.quantity]: data[w.quantity],
        [w.hidden]: data[w.hidden]
    }));
    await orderBookSize(s + w.bids + w.STOP, 0);
    await orderBookSize(s + w.asks + w.STOP, 1);
    strictEqual((await redis[0].zrangeAsync(s + w.asks + w.STOP, 0, -1))[0],
        JSON.stringify({
            [w.timestamp]: data[w.timestamp],
            [w.orderId]: data[w.id],
            [w.cluster]: user[0],
            [w.id]: user,
        }));

    ({data, error} = await httpGet('/c' + query({[w.id]: data[w.id]}), session));
    strictEqual(error, false);
    strictEqual(data, w.ORDER_CANCELLED);

    await orderBookSize(s + w.asks, 0);
    await orderBookSize(s + w.asks + w.STOP, 0);
    await closedOrdersSize(user, 1);

    ({data, error} = await order({q: 1e8, p: 1e8, s, a: 's', e: 'GTC', oco: 1e8 / 2}, session));
    strictEqual(error, false);

    ({error} = await order({q: 2e8, p: 1e8 / 2, s, a: 'b', e: 'GTC'}, await createUser([w.free, 1e8])));
    strictEqual(error, false);
    ({error} = await order({q: 1e8, p: 1e8 / 2, s, a: 's', e: 'GTC'}, await createUser([w.free, 1e8])));
    strictEqual(error, false);

    await wait(100);
    await orderBookSize(s + w.bids + w.STOP, 0);
    await orderBookSize(s + w.asks + w.STOP, 0);
    await orderBookSize(s + w.asks, 0);
    await orderBookSize(s + w.bids, 0);

    strictEqual(await getProp(user + data[w.id], w.fill), 1e8);
    strictEqual(await getProp(user + data[w.id], w.status, true), w.filled);
    await closedOrdersSize(user, 2);
    strictEqual(await redis[user[0]].lindexAsync(user + w.closedOrders, 0), data[w.id]);
    await checkBalance(user, w.free, 1e8 / 2, w.locked, 1e8 / 2, w.margin, 0);

    process.exit(0);
})();