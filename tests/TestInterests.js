const {strictEqual} = require('assert');
const w = require('../words');
const co = require('../constants');
const {wait, getCluster} = require("../utilities/commons");
const {clearCache} = require("./clearCache");
const {order, httpGet, query} = require("./utilities");
const mongo = require("../mongo");
const redis = require("../redis");
const {checkPos} = require("./utilities");
const {checkBalance} = require("./utilities");
const {openOrdersSize} = require("./utilities");
const {BTCSize} = require("./utilities");
const {createUser, getProp} = require("./utilities");

let data, session, user, session2, user2;

(async () => {
    await clearCache();
    const email = Date.now() + "@mail.com", password = "rgezfgnbezgloergezer98479za4é";
    ({data} = await httpGet('/signup' + query({email, password})));
    session = data;
    user = await redis[w.minus + 0].getAsync("session" + session);
    await redis[user[0]].hincrbyAsync(user, w.free, 1e8, w.fundingFree, 9e8);
    const lend = await order({q: 9e8, p: 0.05 * 1e8, s: 'BTC', a: 's', e: w.GTC}, session);
    await order({q: 5e8, p: 1e8, s: 'BLX', a: 'b', e: w.GTC}, session);
    await order({q: 5e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session);
    await checkBalance(user, w.free, 0, w.locked, 1e8, w.margin, 9e8);
    await order({q: 5e8, p: 1e8, s: 'BLX', a: 's', e: w.GTC}, await createUser([w.free, 10e8]));
    await order({q: 5e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, await createUser([w.free, 10e8]));
    await checkPos(user, 'ETH', {q: -5e8, p: 1e8, sq: -5e8, pnl: 0});
    await checkPos(user, 'BLX', {q: 5e8, p: 1e8, sq: 5e8, pnl: 0});
    await wait(100);
    await BTCSize(user, 2);

    await order({q: 1e8, p: 2e8, s: 'BLX', a: 's', e: w.GTC}, session);
    await order({q: 1e8, p: 2e8, s: 'BLX', a: 'b', e: w.GTC}, await createUser([w.free, 2e8]));

    await checkPos(user, 'BLX', {q: 4e8, p: 1e8, sq: 5e8, pnl: 1e8});
    await wait(100);
    await BTCSize(user, 2);

    while (!user2 || user2[0] !== user[0]) [session2, user2] = await createUser();

    await redis[user[0]]["copyAsync"](user, user2);
    await redis[user[0]]["copyAsync"](user + w.borrowed, user2 + w.borrowed);

    const borrowed = JSON.parse(await redis[user[0]].lindexAsync(user + w.borrowed, 0));
    borrowed[w.timestamp] = 1;
    await redis[user[0]].lsetAsync(user + w.borrowed, 0, JSON.stringify(borrowed));
    co[w.cluster] = 0;
    require('../services/master/interests');
    await wait(100);
    await BTCSize(user, 0);
    const lendId = user + lend.data.id;
    await openOrdersSize(user, 0);
    strictEqual(await getProp(lendId, w.status, true), w.filled);
    await checkBalance(user, w.free, 0, w.locked, 0, w.margin, 0, w.fundingFree, 9e8 + (1e8 + 1e8) * 0.95); // BLX pnl
    strictEqual(await redis[user[0]].llenAsync(user + w.balance), 1);
    strictEqual(JSON.parse(await redis[user[0]].lindexAsync(user + w.balance, 0))[2], 1e8);
    const saved = await mongo[0].collection(w.balance + getCluster(user)).find({id: user}).toArray();
    strictEqual(saved.length, 1);
    strictEqual(saved[0][w.label], "Return Borrowed Bitcoin PNL 5.00000000BLX@1.00000000");

    await checkBalance(user2, w.locked, 2e8, w.margin, 7e8);
    await checkPos(user2, 'BLX', {q: 4e8, p: 1e8, sq: 5e8, pnl: 1e8});
    await checkPos(user2, 'ETH', {q: -5e8, p: 1e8, sq: -5e8, pnl: 0});

    process.exit(0);
})();
