const redis = require("../redis");
const w = require('../words');
const {strictEqual} = require('assert');
const {checkOrdersMongo} = require("./utilities");
const {closedOrdersSize} = require("./utilities");
const {openOrdersSize} = require("./utilities");
const {clearCache} = require("./clearCache");
const {checkPos} = require("./utilities");
const {clearLock} = require("./utilities");
const {getProp} = require("./utilities");
const {createUser} = require("./utilities");
const {order} = require("./utilities");

let error, data;
const s = 'ETH';

(async () => {

    for (const t of [['s', w.bids, 'b'], ['b', w.asks, 's']]) {
        const [a, obType, a2] = t;

        await clearCache();

        await order({q: 1e8, p: 1e8, s, a: 'b', e: w.GTC}, await createUser([w.free, 1e8]));
        await order({q: 1e8, p: 1e8, s, a: 's', e: w.GTC}, await createUser([w.free, 1e8]));

        const [session, user] = await createUser([w.free, 1e8]);
        ({error, data} = await order({q: 1e8, p: 1e8, s, a, e: w.MKT}, session));
        strictEqual(error, true);
        strictEqual(data, w.ORDER_KILLED);
        await openOrdersSize(user, 0);
        await closedOrdersSize(user, 0);
        await checkOrdersMongo(user, 0);
        await clearLock(user, user[0]);

        const users = {};

        for (let i = 0; i < 25; i++) {
            users[i] = await createUser([w.free, 1e8]);
            await order({q: 1e8, p: 1e8, s, a: a2, e: w.GTC}, users[i]);
        }

        strictEqual(await redis[0].zcardAsync(s + obType), 25);

        ({error} = await order({q: 20e8, s, a, e: w.MKT}, await createUser([w.free, 20e8])));
        strictEqual(error, false);

        strictEqual(await redis[0].zcardAsync(s + obType), 5);

        for (let i in users) {
            strictEqual(await getProp(users[i][1], w.free), 0);
            strictEqual(await getProp(users[i][1], w.locked), 1e8);
            await checkPos(users[i][1], s, i < 20 ? {
                "q": (a === w.sell ? 1e8 : -1e8),
                "p": 1e8,
                "sq": (a === w.sell ? 1e8 : -1e8),
                "pnl": 0
            } : null);
        }

        ({error, data} = await order({q: 20e8, s, a, e: w.MKT}, await createUser([w.free, 20e8])));
        strictEqual(error, false);
        strictEqual(data[w.status], w.cancelled);
        strictEqual(data[w.fill], 5e8);

        strictEqual(await redis[0].zcardAsync(s + w.asks), 0);
        strictEqual(await redis[0].zcardAsync(s + w.bids), 0);
    }
    process.exit(0);
})();