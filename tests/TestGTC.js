const {strictEqual} = require('assert');
const redis = require("../redis");
const w = require('../words');
const {clearCache} = require("./clearCache");
const {checkPos} = require("./utilities");
const {getProp} = require("./utilities");
const {createUser} = require("./utilities");
const {order} = require("./utilities");

let error, data;
const s = 'ETH';

(async () => {

    for (const t of [['s', w.bids, 'b', w.asks], ['b', w.asks, 's', w.bids]]) {
        const [a, obType, a2, obType2] = t;

        await clearCache();

        const users = {};

        for (let i = 0; i < 35; i++) {
            users[i] = await createUser([w.free, 1e8]);
            await order({q: 1e8, p: 1e8, s, a: a2, e: w.GTC}, users[i]);
        }

        strictEqual(await redis[0].zcardAsync(s + obType), 35);

        ({error, data} = await order({q: 30e8, s, a, p: 1e8, e: w.GTC}, await createUser([w.free, 30e8])));
        strictEqual(error, false);
        strictEqual(data[w.status], w.filled);
        strictEqual(data[w.fill], 30e8);
        strictEqual(await redis[0].zcardAsync(s + obType), 5);
        strictEqual(await redis[0].zcardAsync(s + obType2), 0);

        for (let i in users) {
            await checkPos(users[i][1], s, i < 30 ? {
                "q": (a === w.sell ? 1e8 : -1e8),
                "p": 1e8,
                "sq": (a === w.sell ? 1e8 : -1e8),
                "pnl": 0
            } : null);
            strictEqual(await getProp(users[i][1], w.locked), 1e8);
            strictEqual(await getProp(users[i][1], w.free), 0);
        }

        const user = await createUser([w.free, 20e8]);
        ({error, data} = await order({q: 20e8, s, a, p: 1e8, e: w.GTC}, user));
        strictEqual(data[w.status], w.opened);
        strictEqual(error, false);
        strictEqual(data[w.fill], 5e8);

        strictEqual(await redis[0].zcardAsync(s + obType), 0);
        strictEqual(await redis[0].zcardAsync(s + obType2), 1);
        strictEqual((await redis[0].zrangeAsync(s + obType2, 0, -1))[0], JSON.stringify({
            [w.timestamp]: Number(data[w.timestamp]),
            [w.orderId]: data[w.id],
            c: user[1][0],
            [w.id]: user[1],
            [w.quantity]: 15e8,
            [w.hidden]: data[w.hidden],
        }));
    }
    process.exit(0);
})();