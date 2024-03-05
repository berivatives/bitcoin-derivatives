const w = require('../words');
const {strictEqual} = require('assert');
const {clearCache} = require("./clearCache");
const redis = require("../redis");
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
        ({error, data} = await order({q: 1e8, p: 1e8, s, a, e: w.FOK}, session));
        strictEqual(error, true);
        strictEqual(data, w.ORDER_KILLED);
        await closedOrdersSize(user, 0);
        await clearLock(user, user[0]);

        await order({q: 1e8, p: 1e8, s, a: a2, e: w.GTC}, await createUser([w.free, 1e8]));
        strictEqual(await redis[0].zcardAsync(s + obType), 1);

        ({error, data} = await order({q: 1e8 + 1, p: 1e8, s, a, e: w.FOK}, session));
        strictEqual(error, true);
        strictEqual(data, w.ORDER_KILLED);
        await closedOrdersSize(user, 0);
        await clearLock(user, user[0]);

        ({error, data} = await order({q: 1e8, p: 1e8, s, a, e: w.FOK}, session));
        strictEqual(error, false);
        await closedOrdersSize(user, 1);
        strictEqual(await redis[user[0]].lindexAsync(user + w.closedOrders, 0), data[w.id]);
        strictEqual(await redis[0].zcardAsync(s + obType), 0);
    }

    process.exit(0);
})();