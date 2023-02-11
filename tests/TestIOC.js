const {strictEqual} = require('assert');
const w = require('../words');
const {clearCache} = require("./clearCache");
const redis = require("../redis");
const {openOrdersSize} = require("./utilities");
const {closedOrdersSize} = require("./utilities");
const {clearLock} = require("./utilities");
const {createUser} = require("./utilities");
const {order} = require("./utilities");

let error, data;
const s = 'ETH';

(async () => {

    for (const t of [['s', w.bids, 'b'], ['b', w.asks, 's']]) {
        const [a, obType, a2] = t;
        await clearCache();
        const [session, user] = await createUser([w.free, 1e8]);
        ({error, data} = await order({q: 1e8, p: 1e8, s, a, e: w.IOC}, session));
        strictEqual(data, w.ORDER_KILLED);
        strictEqual(error, true);
        await clearLock(user, user[0]);
        await closedOrdersSize(user, 0);
        await openOrdersSize(user, 0);

        await order({q: 1e8 / 2, p: 1e8, s, a: a2, e: w.GTC}, await createUser([w.free, 1e8]));
        strictEqual(await redis[0].zcardAsync(s + obType), 1);

        ({error, data} = await order({q: 1e8, p: 1e8, s, a, e: w.IOC}, session));
        strictEqual(error, false);
        strictEqual(data[w.status], w.cancelled);
        strictEqual(data[w.price], 1e8);
        strictEqual(data[w.quantity], 1e8);
        strictEqual(data[w.fill], 1e8 / 2);
        strictEqual(await redis[user[0]].lindexAsync(user + w.closedOrders, 0), data[w.id]);
        await closedOrdersSize(user, 1);
        await openOrdersSize(user, 0);
        strictEqual(await redis[0].zcardAsync(s + obType), 0);
    }

    process.exit(0);
})();