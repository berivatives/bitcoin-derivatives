const {strictEqual} = require('assert');
const w = require('../words');
const {wait} = require("../utilities/commons");
const {clearCache} = require("./clearCache");
const redis = require("../redis");
const mongo = require("../mongo");
const {checkBalance} = require("./utilities");
const {BTCSize} = require("./utilities");
const {publish, getCluster} = require("../utilities/commons");
const {createUser, getProp, order} = require("./utilities");


(async () => {

    await clearCache();

    let now, data;

    /*******Classic deposit********/
    let [session, user, c] = await createUser([w.free, 0]);
    for (let i = 1; i < 3; i++) {
        now = Date.now();
        publish([user, c, null, 1e8, [now, "Deposit", 1e8], ""], c, w.deposits);
        await wait(100);
        await checkBalance(user, w.free, 1e8 * i, w.fundingFree, 0);
        data = await mongo[user[0]].collection(w.balance + getCluster(user)).find({id: user}).toArray();
        strictEqual(data.length, i);
        strictEqual(data[i - 1][w.timestamp], now);
        strictEqual(data[i - 1][w.label], "Deposit");
        strictEqual(data[i - 1][w.quantity], 1e8);
        strictEqual(await redis[user[0]][w.lindexAsync](user + w.balance, 0), JSON.stringify([now, "Deposit", 1e8]));
        strictEqual(await redis[user[0]][w.llenAsync](user + w.balance), i);
    }
    /*******Classic deposit********/


    /*****Return borrowed BTC after deposit*****/
    for (const q of [1e8, 1e8 / 2]) {
        await clearCache();
        await order({q: 2e8, p: 0.06 * 1e8, s: 'BTC', a: 's', e: 'GTC'}, await createUser([w.fundingFree, 2e8]));
        await order({q: 1e8, p: 2e8, s: 'ETH', a: 's', e: 'GTC'}, await createUser([w.free, 2e8]));
        [session, user, c] = await createUser([w.free, 1e8]);
        await order({q: 1e8, p: 2e8, s: 'ETH', a: 'b', e: 'GTC'}, session);
        now = Date.now();
        await wait(50);
        publish([user, c, null, q, [now, "Deposit", q], ""], c, w.deposits);
        await wait(50);
        data = await getProp(user, w.free);
        strictEqual(-20 < data && data < 0, true);
        strictEqual(await getProp(user, w.fundingFree), 0);
        data = await mongo[user[0]].collection(w.balance + getCluster(user)).find({id: user}).toArray();
        strictEqual(data.length, 1);
        strictEqual(data[0][w.timestamp], now);
        strictEqual(data[0][w.label], "Deposit");
        strictEqual(data[0][w.quantity], q);
        data = await getProp(user, w.free);
        strictEqual(-20 < data && data < 0, true);
        strictEqual(await getProp(user, w.fundingFree), 0);
        if (q === 1e8) {
            await BTCSize(user, 0);
            await checkBalance(user, w.locked, 2e8, w.margin, 0);
        } else {
            await BTCSize(user, 1);
            await checkBalance(user, w.locked, 1e8 * 1.5, w.margin, 1e8 * 0.5);
            data = JSON.parse(await redis[user[0]].lindexAsync(user + w.borrowed, 0));
            strictEqual(data[w.quantity], 1e8 * 0.5);
        }
    }
    /*****Return borrowed BTC after deposit*****/

    process.exit(0);
})();