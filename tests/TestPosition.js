const {strictEqual} = require('assert');
const w = require('../words');
const {clearCache} = require("./clearCache");
const {order, createUser} = require("./utilities");
const mongo = require("../mongo");
const redis = require("../redis");
const {clearLock} = require("./utilities");
const {BTCSize} = require("./utilities");
const {checkBalance} = require("./utilities");
const {openOrdersSize} = require("./utilities");
const {checkPos} = require("./utilities");
const {getProp} = require("./utilities");
const {wait, getCluster} = require("../utilities/commons");

let error, data;

let session, user, session2, user2;

(async () => {

    await basic();
    await basic(1e8 + 1e8 / 2);

    await clearCache();

    await order({q: 5e8, p: 0.04 * 1e8, s: 'BTC', a: 's', e: w.GTC}, await createUser([w.fundingFree, 5e8]));

    [session, user] = await createUser([w.free, 1e8]);
    ({error} = await order({q: 2e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session));
    strictEqual(error, false);

    [session2, user2] = await createUser([w.free, 1e8]);
    ({error} = await order({q: 2e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session2));
    strictEqual(error, false);

    const basicCheck = async (u, short) => {
        const q = short ? -2e8 : 2e8;
        await checkPos(u, 'ETH', {q, p: 1e8, sq: q, pnl: 0});
        strictEqual(await getProp(u, w.free), 0);
        strictEqual(await getProp(u, w.counter + w.order), 2);
        strictEqual(await getProp(u, w.locked), 1e8);
        strictEqual(await getProp(u, w.margin), 1e8);
        await BTCSize(u, 1);
    };

    await wait(100);
    await basicCheck(user);
    await basicCheck(user2, true);

    ({error} = await order({q: 2e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session));
    strictEqual(error, false);
    ({error} = await order({q: 2e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session2));
    strictEqual(error, false);

    await wait(100);
    await BTCSize(user, 0);
    await BTCSize(user2, 0);


    /****Reduce a position with 4 orders and see if pnl and balance are set correctly****/
    await clearCache();
    [session, user] = await createUser([w.free, 1e8]);
    await order({q: 1e8, p: 1e8, s: 'GOLD', a: 'b', e: w.GTC}, session);
    [session2, user2] = await createUser([w.free, 1e8]);
    await order({q: 1e8, p: 1e8, s: 'GOLD', a: 's', e: w.GTC}, session2);
    await checkPos(user, 'GOLD', {q: 1e8, p: 1e8, sq: 1e8, pnl: 0});
    await checkPos(user2, 'GOLD', {q: -1e8, p: 1e8, sq: -1e8, pnl: 0});
    for (let i = 1; i < 5; i++) {
        await order({q: 1e8 / 4, p: 1e8 * 1.5, s: 'GOLD', a: 's', e: w.GTC}, session);
        await order({q: 1e8 / 4, p: 1e8 * 1.5, s: 'GOLD', a: 'b', e: w.GTC}, session2);
        const q = 1e8 - i * 0.25 * 1e8, pnl = (i * 0.25 * (1e8 * 1.5 - 1e8));
        await checkPos(user, 'GOLD', i === 4 ? null : {q, p: 1e8, sq: 1e8, pnl});
        await checkPos(user2, 'GOLD', i === 4 ? null : {q: -q, p: 1e8, sq: -1e8, pnl: -pnl});
        strictEqual(await getProp(user, w.free), 1e8 - q + pnl);
        strictEqual(await getProp(user, w.locked), q);
        strictEqual(await getProp(user2, w.free), 1e8 - q - pnl);
        strictEqual(await getProp(user2, w.locked), q);

    }
    /****Reduce a position with 4 orders and see if pnl and balance are set correctly****/


    /****Big price using counterpart but close position with order who needs to borrow and return the coin****/
    await clearCache();
    [session, user] = await createUser([w.free, 1e8]);
    [session2, user2] = await createUser([w.free, 2e8]);
    await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session);
    await order({q: 1e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session2);

    strictEqual(await getProp(user, w.free), 0);
    strictEqual(await getProp(user, w.locked), 1e8);
    strictEqual(await getProp(user, w.margin), 0);

    await order({q: 1e8, p: 1e8 * 10, s: 'ETH', a: 's', e: w.GTC}, session);

    strictEqual(await getProp(user, w.free), 0);
    strictEqual(await getProp(user, w.locked), 1e8);
    strictEqual(await getProp(user, w.margin), 0);
    strictEqual(await getProp(user, 'ETH' + w.sellUsed), 1e8);

    await order({q: 1e8, p: 1e8 * 1.5, s: 'ETH', a: 's', e: w.GTC}, session);

    strictEqual(await getProp(user, w.free), 0);
    strictEqual(await getProp(user, w.locked), 1e8);
    strictEqual(await getProp(user, w.margin), 1e8 * 1.5);
    strictEqual(await getProp(user, 'ETH' + w.sellUsed), 1e8);

    await order({q: 1e8, p: 1e8 * 1.5, s: 'ETH', a: 'b', e: w.GTC}, session2);

    await wait(100);

    await BTCSize(user, 0);
    await BTCSize(user2, 0);
    await checkBalance(user, w.free, 1e8 * 1.5, w.locked, 0, w.margin, 0);
    await checkPos(user, 'ETH', null);

    await checkBalance(user2, w.free, 2e8 - 1e8 * 0.5, w.locked, 0, w.margin, 0);
    await checkPos(user2, 'ETH', null);

    await openOrdersSize(user, 1);
    await openOrdersSize(user2, 0);

    ({data, error} = await order({q: 1e8 / 10, p: 1e8 * 10, s: 'ETH', a: 'b', e: w.GTC}, session2));
    strictEqual(error, false);

    strictEqual(await getProp(user2, w.free), 1e8 / 2);
    strictEqual(await getProp(user2, w.locked), 1e8);
    strictEqual(await getProp(user2, w.margin), 0);

    await openOrdersSize(user, 1);
    await openOrdersSize(user2, 0);
    /****Big price using counterpart but close position with order who needs to borrow and return the coin****/


    /****Leverage 2 then sell below entry price so negative PNL but keeps 25% of the borrowed amount to hold the GOLD position****/
    await clearCache();
    await order({q: 2e8, p: 0.04 * 1e8, s: 'BTC', a: 's', e: w.GTC}, await createUser([w.fundingFree, 2e8]));

    [session, user] = await createUser([w.free, 1e8]);
    await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session);
    await order({q: 1e8, p: 1e8, s: 'GOLD', a: 'b', e: w.GTC}, session);

    [session2, user2] = await createUser([w.free, 1e8]);
    await order({q: 1e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session2);
    await order({q: 1e8, p: 1e8, s: 'GOLD', a: 's', e: w.GTC}, session2);

    await wait(10);

    await BTCSize(user, 1);
    await BTCSize(user2, 1);

    await order({q: 1e8, p: 1e8 * 0.75, s: 'ETH', a: 's', e: w.GTC}, session);
    await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session2);

    await wait(100);
    let freeLessInterests = await getProp(user, w.free);
    strictEqual(freeLessInterests <= 0 && freeLessInterests >= -5, true);
    strictEqual(await getProp(user, w.locked), 1e8 * 0.75);
    strictEqual(await getProp(user, w.margin), 1e8 * 0.25);
    /****Leverage 2 then sell below entry price so negative PNL but keeps 25% of the borrowed amount to hold the GOLD position****/


    /*******Case allow to reduce a tiny position with tiny order******/
    for (const q of [1, -1]) {
        await clearCache();
        [session, user] = await createUser([w.free, 1e8]);
        await redis[user[0]].hsetAsync(user, w.positions + 'GOLD', JSON.stringify({q: q, p: 1e8, sq: q}));
        ({error, data} = await order({q: 1, p: 1e8, s: 'GOLD', a: q === 1 ? 's' : 'b', e: 'GTC'}, session));
        strictEqual(error, false);
        strictEqual(data.q, 1);
    }
    /*******Case allow to reduce a tiny position with tiny order******/


    /*******Create opposite position******/
    await clearCache();
    [session, user] = await createUser([w.free, 10e8]);
    await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session);
    await checkBalance(user, w.free, 9e8, w.locked, 1e8);
    await order({q: 1e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, await createUser([w.free, 1e8]));
    await order({q: 4e8, p: 2e8, s: 'ETH', a: 's', e: w.GTC}, session);
    await checkBalance(user, w.free, 3e8, w.locked, 7e8);
    await order({q: 4e8, p: 2e8, s: 'ETH', a: 'b', e: w.GTC}, await createUser([w.free, 10e8]));
    await checkBalance(user, w.free, 5e8, w.locked, 6e8);
    await checkPos(user, 'ETH', {q: -3e8, p: 2e8, sq: -3e8, pnl: 0});
    /*******Create opposite position******/


    /*******Case try to create a tiny opposite position******/
    await tryReducePosition(1e8 + 1);
    /*******Case try to create a tiny opposite position******/


    /*******Case try to reduce a position with tiny order******/
    await tryReducePosition(1);
    /*******Case try to reduce a position with tiny order******/


    /*******close a tiny position due to bad rounding******/
    await clearCache();
    [session, user] = await createUser([w.free, 1e8]);
    await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, await createUser([w.free, 1e8]));
    await order({q: 1e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session);
    await checkBalance(user, w.free, 0, w.locked, 1e8);
    [session2, user2] = await createUser([w.free, 1e8]);
    await order({q: 1e8, p: 3e8, s: 'ETH', a: 's', e: w.GTC}, session2);
    ({data} = await order({q: 1e8, s: 'ETH', a: 'b', e: w.MKT}, session));
    strictEqual(data[w.status], w.filled);
    await order({q: 1, s: 'ETH', a: 'b', e: w.MKT}, session);
    await checkBalance(user, w.free, 0);
    await checkPos(user, 'ETH', null);
    await checkPos(user2, 'ETH', {q: Math.round(-1 / 3 * 1e8), p: 3e8, sq: Math.round(-1 / 3 * 1e8), pnl: 0});
    /*******close a tiny position due to bad rounding******/


    /*******Profitable position that reduces a possible future lend******/
    await clearCache();
    [session, user] = await createUser([w.free, 1e8]);
    await order({q: 1e8, s: 'ETH', a: 'b', p: 1e8, e: 'GTC'}, session);
    await checkBalance(user, w.free, 0, w.locked, 1e8, w.margin, 0);
    await order({q: 1e8, s: 'GOLD', a: 'b', p: 1e8, e: 'GTC'}, session);
    await checkBalance(user, w.free, 0, w.locked, 1e8, w.margin, 1e8);
    await order({q: 1e8, s: 'ETH', a: 's', p: 1e8, e: 'GTC'}, await createUser([w.free, 2e8]));
    await checkBalance(user, w.free, 0, w.locked, 1e8, w.margin, 1e8);
    await order({q: 1e8, s: 'ETH', a: 's', p: 2e8, e: 'GTC'}, session);
    await order({q: 1e8, s: 'ETH', a: 'b', p: 2e8, e: 'GTC'}, await createUser([w.free, 5e8]));
    await order({q: 1e8, s: 'GOLD', a: 's', p: 1e8, e: 'GTC'}, await createUser([w.free, 5e8]));
    await checkBalance(user, w.free, 1e8, w.locked, 1e8, w.margin, 0);
    await BTCSize(user, 0);
    /*******Profitable position that reduces a possible future lend******/


    /*******Limit of an infinite profit PNL******/
    await clearCache();
    [session, user] = await createUser([w.free, 5000]);
    await order({q: 5e8 * 1000, p: 1, s: 'ETH', a: 's', e: w.GTC}, session);
    [session2, user2] = await createUser([w.free, 5000]);
    await order({q: 5e8 * 1000, p: 1, s: 'ETH', a: 'b', e: w.GTC}, session2);
    await order({q: 5e8 * 1000, p: 1e8 * 100 - 1, s: 'ETH', a: 's', e: w.GTC}, session2);
    await order({q: 5e8 * 1000, p: 1e8 * 100 - 1, s: 'ETH', a: 'b', e: w.GTC}, session);
    await checkBalance(user, w.free, 0, w.locked, 0, w.margin, 0);
    await checkPos(user2, 'ETH', {q: 499999999950, p: 1, sq: 5e8 * 1000, pnl: 5000});
    await order({q: 50, p: 1e8 * 100 - 1, s: 'ETH', a: 'b', e: w.GTC}, session);
    await checkBalance(user, w.free, 0, w.locked, 0, w.margin, 0);
    await checkPos(user, 'ETH', null);
    /*******Limit of an infinite profit PNL******/


    /****fill at the same time 2 closings positions 1ETH@1 & 1GOLD@1 sell @0.75 with maker orders and see what happen****/
    await clearCache();
    const triggerTs = Date.now() + 500;
    [session] = await createUser([w.free, 1e8], null, null, "trigger" + triggerTs, "0");
    await order({q: 10e8, p: 1e8 * 0.05, s: 'BTC', a: 's', e: w.GTC}, await createUser([w.fundingFree, 10e8]));
    await order({q: 1e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, await createUser([w.free, 1e8]));
    await order({q: 1e8, p: 1e8, s: 'GOLD', a: 's', e: w.GTC}, await createUser([w.free, 1e8]));

    await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session);
    await order({q: 1e8, p: 1e8, s: 'GOLD', a: 'b', e: w.GTC}, session);
    await wait(100);
    await order({q: 1e8, p: 1e8 * 0.75, s: 'GOLD', a: 's', e: w.GTC}, session);
    await order({q: 1e8, p: 1e8 * 0.75, s: 'ETH', a: 's', e: w.GTC}, session);
    // noinspection ES6MissingAwait
    order({q: 1e8, p: 1e8 * 0.75, s: 'GOLD', a: 'b', e: w.GTC}, await createUser([w.free, 1e8]));
    // noinspection ES6MissingAwait
    order({q: 1e8, p: 1e8 * 0.75, s: 'ETH', a: 'b', e: w.GTC}, await createUser([w.free, 1e8]));
    await wait(3000);
    /****fill at the same time 2 closings positions 1ETH@1 & 1GOLD@1 sell @0.75 with maker orders and see what happen****/


    /****all in****/
    await clearCache();
    await order({q: 10e8, p: 1e8 * 0.04, s: 'BTC', a: 's', e: w.GTC}, await createUser([w.fundingFree, 10e8]));
    [session, user] = await createUser([w.free, 1e8]);
    await order({q: 10e8, p: 1e8, s: 'BLX', a: 's', e: w.GTC}, await createUser([w.free, 20e8]));
    await order({q: 10e8, p: 1e8, s: 'BLX', a: 'b', e: w.GTC}, session);
    await checkPos(user, 'BLX', {q: 10e8, p: 1e8, sq: 10e8, pnl: 0});
    await checkBalance(user, w.free, 0, w.locked, 1e8, w.margin, 9e8);
    ({error, data} = await order({q: 11e8, p: 1e8, s: 'BLX', a: 's', e: w.GTC}, session));
    strictEqual(error, true);
    strictEqual(data, w.INSUFFICIENT_BALANCE);
    await clearLock(user, user[0]);
    await order({q: 10e8, p: 1.1e8, s: 'BLX', a: 's', e: w.GTC}, session);
    await order({q: 10e8, p: 1.1e8, s: 'BLX', a: 'b', e: w.GTC}, await createUser([w.free, 20e8]));
    await checkPos(user, 'BLX', null);
    await checkBalance(user, w.locked, 0, w.margin, 0);
    /****all in****/


    process.exit(0);
})();

async function basic(exitPrice) {
    await clearCache();

    [session2, user2] = await createUser([w.free, 1e8]);
    ({data, error} = await order({q: 1e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session2));
    strictEqual(error, false);

    [session, user] = await createUser([w.free, 1e8]);
    ({data, error} = await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session));
    strictEqual(error, false);

    await checkPos(user, 'ETH', {q: 1e8, p: 1e8, sq: 1e8, pnl: 0});
    await checkPos(user2, 'ETH', {q: -1e8, p: 1e8, sq: -1e8, pnl: 0});

    ({data, error} = await order({q: 1e8, p: exitPrice || 1e8, s: 'ETH', a: 's', e: w.GTC}, session));
    strictEqual(error, false);
    strictEqual(data[w.counterPart], 1e8);

    ({data, error} = await order({q: 1e8, p: exitPrice || 1e8, s: 'ETH', a: 'b', e: w.GTC}, session2));
    strictEqual(error, false);

    await checkPos(user, 'ETH', null);
    await checkPos(user2, 'ETH', null);

    if (exitPrice) {
        strictEqual(await getProp(user, w.free), exitPrice);

        let balanceMsg = await checkBalanceLog(user, 1);
        strictEqual(balanceMsg[w.label], "PNL 1.00000000ETH@1.00000000");
        strictEqual(balanceMsg[w.quantity], exitPrice - 1e8);

        balanceMsg = JSON.parse(await redis[user[0]].lindexAsync(user + w.balance, 0));
        strictEqual(balanceMsg[1], "PNL 1.00000000ETH@1.00000000");
        strictEqual(balanceMsg[2], exitPrice - 1e8);

        strictEqual(await getProp(user2, w.free), 1e8 - (exitPrice - 1e8));

        balanceMsg = await checkBalanceLog(user2, 1);
        strictEqual(balanceMsg[w.label], "PNL -1.00000000ETH@1.00000000");
        strictEqual(balanceMsg[w.quantity], 1e8 - exitPrice);

        balanceMsg = JSON.parse(await redis[user2[0]].lindexAsync(user2 + w.balance, 0));
        strictEqual(balanceMsg[1], "PNL -1.00000000ETH@1.00000000");
        strictEqual(balanceMsg[2], 1e8 - exitPrice);
    } else {
        strictEqual(await getProp(user, w.free), 1e8);
        strictEqual(await redis[user[0]].llenAsync(user + w.balance), 0);
        await checkBalanceLog(user, 0);

        strictEqual(await getProp(user2, w.free), 1e8);
        strictEqual(await redis[user2[0]].llenAsync(user2 + w.balance), 0);
        await checkBalanceLog(user2, 0);
    }

    strictEqual(await getProp(user, w.locked), 0);
    strictEqual(await getProp(user, w.counter + w.order), 2);
    strictEqual(await getProp(user2, w.locked), 0);
    strictEqual(await getProp(user2, w.counter + w.order), 2);
}

async function checkBalanceLog(u, expected) {
    strictEqual(await redis[u[0]].llenAsync(u + w.balance), expected);
    const balanceMsg = await mongo[u[0]].collection(w.balance + getCluster(u)).find({[w.id]: u}).toArray();
    strictEqual(balanceMsg.length, expected);
    return balanceMsg[0];
}

async function tryReducePosition(q) {
    for (const a of [w.sell, w.buy]) {
        await clearCache();
        [session] = await createUser([w.free, 1e8]);
        await order({q: 1e8, p: 1e8, s: 'GOLD', a: a === w.sell ? 'b' : 's', e: 'GTC'}, session);
        await order({q: 1e8, p: 1e8, s: 'GOLD', a, e: 'GTC'}, await createUser([w.free, 2e8]));
        ({error, data} = await order({q, p: 1e8, s: 'GOLD', a, e: 'GTC'}, session));
        strictEqual(error, true);
        strictEqual(data, w.MINIMAL_AMOUNT);
    }
}