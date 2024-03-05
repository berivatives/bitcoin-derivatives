const {strictEqual} = require('assert');
const w = require('../words');
const {wait, getCluster} = require("../utilities/commons");
const {clearCache} = require("./clearCache");
const mongo = require("../mongo");
const redis = require("../redis");
const {ObjectId} = require("mongodb");
const {checkBalance} = require("./utilities");
const {BTCSize} = require("./utilities");
const {checkPos} = require("./utilities");
const {openOrdersSize} = require("./utilities");
const {createUser, getProp, order} = require("./utilities");

let error, data;

let session, user, session2, user2;

(async () => {

    await clearCache();
    ({data, error} = await order({
        q: 4e8,
        p: 0.05 * 1e8,
        s: 'BTC',
        a: 'b',
        e: w.GTC
    }, await createUser([w.free, 1e8, w.fundingFree, 4e8])));
    strictEqual(error, true);
    strictEqual(data, w.IMPOSSIBLE_OPERATION);

    [session, user] = await createUser([w.free, 1e8, w.fundingFree, 4e8]);
    ({data, error} = await order({q: 4e8, p: 0.05 * 1e8, s: 'BTC', a: 's', e: w.GTC}, session));
    strictEqual(error, false);
    const orderLend = data;

    ({error} = await order({q: 1e8, p: 1e8, s: 'GOLD', a: 'b', e: w.GTC}, session));
    strictEqual(error, false);
    ({error} = await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session));
    strictEqual(error, false);

    [session2, user2] = await createUser([w.free, 1e8]);

    ({error} = await order({q: 1e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session2));
    strictEqual(error, false);
    ({error} = await order({q: 1e8, p: 1e8, s: 'GOLD', a: 's', e: w.GTC}, session2));
    strictEqual(error, false);

    await wait(50);
    await BTCSize(user, 1);
    await BTCSize(user2, 1);

    const borrowed = JSON.parse(await redis[user[0]].lindexAsync(user + w.borrowed, 0));
    strictEqual(borrowed[w.price], orderLend[w.price]);
    strictEqual(borrowed[w.id], user);
    strictEqual(borrowed[w.order][0], orderLend[w.id]);
    data = await redis[user[0]].hgetallAsync(user + orderLend[w.id]);
    strictEqual(data[borrowed[w.timestamp]], "1.00000000@0.05000000");
    strictEqual(data[w.status], w.opened);

    data = await redis[user[0]].hgetallAsync(user + borrowed[w.order][1]);
    strictEqual(data[borrowed[w.timestamp]], "1.00000000@0.05000000");
    strictEqual(data[w.status], w.filled);


    /*******internal lend******/
    await clearCache();
    [session, user] = await createUser([w.free, 1e8, w.fundingFree, 4e8]);
    [session2, user2] = await createUser([w.free, 1e8]);
    ({data} = await order({q: 4e8, p: 0.05 * 1e8, s: 'BTC', a: 's', e: w.GTC}, session));
    await order({q: 1e8, p: 2e8, s: 'ETH', a: 'b', e: w.GTC}, session);
    await redis[user[0]].hsetAsync(user + data.id, w.status, w.cancelled);
    await order({q: 1e8, p: 2e8, s: 'ETH', a: 's', e: w.GTC}, session2);

    await wait(100);
    await checkBalance(user, w.free, 0, w.locked, 1e8, w.margin, 1e8);

    for (const u of [user, user2]) {
        data = JSON.parse(await redis[u[0]].lindexAsync(u + w.borrowed, 0));
        strictEqual(data[w.quantity], 1e8);
        strictEqual(data[w.price], 1e8 * 0.05);
        strictEqual(data[w.order][0], null);
        await BTCSize(u, 1);
    }
    /*******internal lend******/


    /****Classic borrow and return the bitcoin****/
    await clearCache();
    data = await createUser([w.fundingFree, 10e8]);
    data.o = await order({q: 10e8, p: 0.05 * 1e8, s: 'BTC', a: 's', e: w.GTC}, data);

    [session, user] = await createUser([w.free, 1e8]);
    await order({q: 5e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session);
    [session2, user2] = await createUser([w.free, 1e8]);
    await order({q: 5e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session2);

    await wait(100);
    await BTCSize(user, 1);
    await BTCSize(user2, 1);

    await order({q: 5e8, p: 1e8 * 0.90, s: 'ETH', a: 's', e: w.GTC}, session);
    await order({q: 4e8, p: 1e8, s: 'ETH', a: 'b', e: w.MKT}, session2);

    await wait(10);

    await BTCSize(user, 1);
    const lend = JSON.parse(await redis[user[0]].lindexAsync(user + w.borrowed, 0));

    let freeLessInterests = await getProp(user, w.free);
    strictEqual(-30 <= freeLessInterests && freeLessInterests <= 0, true, "" + freeLessInterests);
    strictEqual(await getProp(user, w.locked), 1e8 * 0.6);
    strictEqual(await getProp(user, w.margin), 1e8 * 0.4);
    strictEqual(lend[w.quantity], await getProp(user, w.margin));

    freeLessInterests = await getProp(user2, w.free);
    strictEqual(1e8 * 0.4 - 50 <= freeLessInterests && freeLessInterests <= 1e8 * 0.4, true, "" + freeLessInterests);
    strictEqual(await getProp(user2, w.locked), 1e8);
    strictEqual(await getProp(user2, w.margin), 0);

    const lenderFee = await getProp(user, w.free) + await getProp(user2, w.free) - 1e8 * 0.4;
    data = await getProp(data[1] + data.o.data.id, w.fee);
    strictEqual(Math.round(lenderFee * 0.95) - 1 <= data && data <= Math.round(lenderFee * 0.95) + 1, true);
    strictEqual(await getProp(user + lend[w.order][1], w.fee), await getProp(user, w.free) * -1);
    await wait(750);
    strictEqual((await mongo[user[0]].collection(w.orders + getCluster(user)).findOne({[w.mongoId]: ObjectId(lend[w.order][1])}))[w.fee], await getProp(user, w.free) * -1);
    /****Classic borrow and return the bitcoin****/


    /****Classic borrow and infinite PNL****/
    await fillBLX();
    await wait(100);
    await BTCSize(user, 1);
    await BTCSize(user2, 1);
    await order({q: 2e8, p: 100e8 - 1, s: 'BLX', a: 's', e: w.GTC}, session);
    ({error, data} = await order({q: 2e8, s: 'BLX', a: 'b', e: w.MKT}, session2));
    strictEqual(error, true);
    strictEqual(data, w.AUTO_LIQUIDATION_FORBIDDEN_TO_PROTECT_LENDERS);
    await BTCSize(user, 1);
    await BTCSize(user2, 1);
    /****Classic borrow and infinite PNL****/


    /****Not borrowed yet but close the position****/
    await fillBLX(true);
    await checkPos(user, 'BLX', {q: 2e8, p: 1e8, sq: 2e8, pnl: 0});
    await checkPos(user2, 'BLX', {q: -2e8, p: 1e8, sq: -2e8, pnl: 0});
    await order({q: 2e8, p: 1e8, s: 'BLX', a: 'b', e: w.GTC}, session2);
    await order({q: 2e8, p: 1e8, s: 'BLX', a: 's', e: w.GTC}, session);
    await wait(1000);
    await openOrdersSize(user, 0);
    await openOrdersSize(user2, 0);
    await BTCSize(user, 0);
    await BTCSize(user2, 0);
    await checkPos(user, 'BLX', null);
    await checkPos(user2, 'BLX', null);
    /****Not borrowed yet but close the position****/

    process.exit(0);
})();

async function fillBLX(internal) {
    await clearCache();
    const [sessionLender, userLender] = await createUser([w.fundingFree, 2e8]);
    const {data} = await order({q: 2e8, p: 0.05 * 1e8, s: 'BTC', a: 's', e: w.GTC}, sessionLender);
    [session, user] = await createUser([w.free, 1e8], null, null, internal ? "0wait" : null, "0");
    await order({q: 2e8, p: 1e8, s: 'BLX', a: 'b', e: w.GTC}, session);
    [session2, user2] = await createUser([w.free, 1e8]);
    if (internal) await redis[userLender[0]].hsetAsync(userLender + data.id, w.status, w.cancelled);
    await order({q: 2e8, p: 1e8, s: 'BLX', a: 's', e: w.GTC}, session2);
}