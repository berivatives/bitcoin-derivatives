const {strictEqual} = require('assert');
const w = require('../words');
const {wait} = require("../utilities/commons");
const {clearCache} = require("./clearCache");
const {order, orderBookSize, httpGet, query, getProp, createUser, clearLock} = require("./utilities");

let error, data;

const users = [];

(async () => {

    // 0 no renew
    // 1 renew
    // 2 stop renew by id
    // 3 stop renew all orders
    for (const t of [0, 1, 2, 3]) {
        await clearCache();
        users.length = 0;
        ({data, error} = await order({
            q: 5e8,
            p: 0.06 * 1e8,
            s: 'BTC',
            a: 's',
            e: w.GTC,
            [w.renew]: t > 0
        }, await createUser([w.fundingFree, 4e8], users)));
        strictEqual(error, true);
        strictEqual(data, w.INSUFFICIENT_BALANCE);
        await clearLock(users[0][1], users[0][1][0]);
        ({data, error} = await order({q: 4e8, p: 0.06 * 1e8, s: 'BTC', a: 's', e: w.GTC, [w.renew]: t > 0}, users[0]));
        strictEqual(error, false);
        strictEqual(await getProp(users[0][1], w.fundingFree), 0);
        strictEqual(await getProp(users[0][1], w.fundingLocked), 4e8);
        await orderBookSize('BTC' + w.asks, 1);
        await order({q: 2e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, await createUser([w.free, 1e8], users));
        await order({q: 2e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, await createUser([w.free, 1e8], users));
        await wait(10);

        strictEqual(await getProp(users[0][1] + data.id, w.status, true), w.opened);
        strictEqual(await getProp(users[0][1] + data.id, w.fill), 2e8, "t:" + t);
        strictEqual(await getProp(users[0][1] + data.id, w.quantity), 4e8);

        await httpGet('/c' + query({[w.id]: data[w.id]}), users[0][0]);
        strictEqual(error, false);
        strictEqual(await getProp(users[0][1], w.fundingFree), 2e8);
        strictEqual(await getProp(users[0][1], w.fundingLocked), 2e8);

        await orderBookSize('BTC' + w.asks, 0);
        await orderBookSize('BTC' + w.bids, 0);

        if (t >= 2) {
            await clearLock(users[0][1] + w.stopRenewal, users[0][1][0]);
            ({error} = await httpGet('/' + w.stopRenewal + query(t === 3 ? {} : {[w.id]: data[w.id]}), users[0][0]));
            strictEqual(error, false);
        }

        if (!t) {
            ({error} = await httpGet('/' + w.stopRenewal + query({[w.id]: data[w.id]}), users[0][0]));
            strictEqual(error, true);
        }

        await order({q: 2e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, users[1]);
        await order({q: 2e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, users[2]);

        await wait(200);
        strictEqual(await getProp(users[0][1], w.fundingFree), (t === 1 ? 2e8 : 4e8) - await getProp(users[0][1] + data.id, w.fee));
        strictEqual(await getProp(users[0][1], w.fundingLocked), (t === 1 ? 2e8 : 0));
        await wait(200);

        await orderBookSize('BTC' + w.asks, t === 1 ? 2 : 0);
    }

    process.exit(0);
})();