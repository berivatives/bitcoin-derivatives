const {strictEqual} = require('assert');
const w = require('../words');
const {wait} = require("../utilities/commons");
const {clearCache} = require("./clearCache");
const {order, httpGet, query} = require("./utilities");
const redis = require("../redis");
const {BTCSize} = require("./utilities");
const {clearLock} = require("./utilities");
const {createUser, getProp} = require("./utilities");

let error, data;

let session, user, session2, user2, session3, user3;

(async () => {

    await init();

    [session, user] = await createUser([w.free, 1e8, w.fundingFree, 5e8]);
    ({error} = await order({q: 5e8, p: 0.05 * 1e8, s: 'BTC', a: 's', e: w.GTC}, session));
    strictEqual(error, false);

    ({error} = await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session));
    strictEqual(error, false);
    ({error} = await order({q: 1e8, p: 1e8, s: 'GOLD', a: 'b', e: w.GTC}, session));
    strictEqual(error, false);

    [session2, user2] = await createUser([w.free, 1e8]);
    ({error} = await order({q: 1e8, p: 1e8, s: 'GOLD', a: 's', e: w.GTC}, session2));
    strictEqual(error, false);
    ({error} = await order({q: 1e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session2));
    strictEqual(error, false);

    ({error, data} = await httpGet('/cl' + query({s: 'ETH'}), session));
    await clearLock(user, user[0]);
    strictEqual(error, true);
    strictEqual(data, w.IMPOSSIBLE_OPERATION);

    [session3, user3] = await createUser([w.free, 1e8]);

    await BTCSize(user, 1);
    await BTCSize(user2, 1);

    ({error} = await order({q: 1e8, p: 1e8 / 2 - 1, s: 'ETH', a: 'b', e: w.GTC}, session2));
    strictEqual(error, false);

    ({error} = await order({q: 1e8, s: 'ETH', a: 's', e: w.MKT}, session3));
    strictEqual(error, false);

    await wait(100);
    ({error, data} = await httpGet('/cl' + query({s: 'ETH'}), session));
    await clearLock(user, user[0]);
    strictEqual(error, false);
    strictEqual(data, w.POSITION_CLAIMED);

    await wait(300);
    await BTCSize(user, 1);
    data = JSON.parse(await redis[user[0]].lindexAsync(user + w.borrowed, 0))[w.quantity];
    strictEqual(1e8 / 2 - 2 <= data && data <= 1e8 / 2, true);

    await init();

    await clearLock(user2, user2[0]);
    ({error, data} = await httpGet('/cl' + query({s: 'ETH'}), session2));
    strictEqual(data, w.POSITION_CLAIMED);
    strictEqual(error, false);

    await wait(100);

    let freeLessInterests = await getProp(user2, w.free);

    strictEqual(-30 < freeLessInterests && freeLessInterests <= 0, true, "" + freeLessInterests);
    await BTCSize(user2, 0);
    strictEqual(await getProp(user2, w.locked), 0);
    strictEqual(await getProp(user2, w.margin), 0);

    await init();

    ({error} = await httpGet('/o' + query({q: 1e8, p: 4e8, s: 'GOLD', a: 'b', e: 'GTC'}), session));
    strictEqual(error, false);

    ({error} = await httpGet('/o' + query({q: 1e8, p: 4e8, s: 'GOLD', a: 's', e: 'GTC'}), session2));
    strictEqual(error, false);
    await wait(100);

    await BTCSize(user2, 2);

    ({error, data} = await httpGet('/cl' + query({s: 'ETH'}), session2));
    await clearLock(user2, user2[0]);
    strictEqual(data, w.POSITION_CLAIMED);
    await wait(100);
    strictEqual(error, false);
    await BTCSize(user2, 1);

    freeLessInterests = await getProp(user2, w.free);
    strictEqual(-150 < freeLessInterests && freeLessInterests < 0, true, "" + freeLessInterests);
    data = await getProp(user2, w.locked);
    strictEqual(66666668 <= data && data <= 66666670, true);//1e8 - 0.3333333 * 1e8
    strictEqual(await getProp(user2, w.margin), 333333330);


    /****Claim with a negative pnl that supposed to not return entirely the borrowed amount to hold the other position****/
    await clearCache();
    await order({q: 10e8, p: 0.05 * 1e8, s: 'BTC', a: 's', e: w.GTC}, await createUser([w.fundingFree, 10e8]));
    [session, user] = await createUser([w.free, 1e8]);
    await order({q: 1e8 * 0.5, p: 1e8, s: 'GOLD', a: 'b', e: w.GTC}, session);
    await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session);
    [session2] = await createUser([w.free, 1e8]);
    await order({q: 1e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session2);
    await order({q: 1e8 * 0.5, p: 1e8, s: 'GOLD', a: 's', e: w.GTC}, session2);
    await order({q: 1e8, p: 1e8 / 3 - 1, s: 'ETH', a: 's', e: w.GTC}, await createUser([w.free, 1e8]));
    await order({q: 1e8, p: 1e8 / 3 - 1, s: 'ETH', a: 'b', e: w.GTC}, await createUser([w.free, 1e8]));

    ({error, data} = await httpGet('/cl' + query({s: 'ETH'}), session));
    strictEqual(data, w.POSITION_CLAIMED);
    strictEqual(error, false);

    await wait(100);
    freeLessInterests = await getProp(user, w.free);
    strictEqual(-5 < freeLessInterests && freeLessInterests <= 0, true, "" + freeLessInterests);
    freeLessInterests = await getProp(user, w.locked);
    strictEqual(Math.round(1e8 / 3) - 5 < freeLessInterests && freeLessInterests <= Math.round(1e8 / 3) + 5, true);
    freeLessInterests = await getProp(user, w.margin);
    strictEqual(Math.round(1e8 / 2 - 1e8 / 3) - 5 < freeLessInterests && freeLessInterests <= Math.round(1e8 / 2 - 1e8 / 3) + 5, true);
    /****Claim with a negative pnl that supposed to not return entirely the borrowed amount to hold the other position****/


    process.exit(0);
})();

async function init() {

    await clearCache();

    [session, user] = await createUser([w.free, 6e8, w.fundingFree, 10e8]);
    ({error, data} = await httpGet('/o' + query({q: 10e8, p: 0.06 * 1e8, s: 'BTC', a: 's', e: 'GTC'}), session));
    strictEqual(error, false);

    ({error} = await httpGet('/o' + query({q: 1e8, p: 2e8, s: 'ETH', a: 'b', e: 'GTC'}), session));
    strictEqual(error, false);

    [session2, user2] = await createUser([w.free, 1e8]);

    ({error, data} = await httpGet('/cl' + query({s: 'ETH'}), session2));
    await clearLock(user2, user2[0]);
    strictEqual(error, true);
    strictEqual(data, w.IMPOSSIBLE_OPERATION);

    ({error, data} = await httpGet('/o' + query({q: 1e8, p: 2e8, s: 'ETH', a: 's', e: 'GTC'}), session2));
    strictEqual(error, false);
    await wait(100);

    await BTCSize(user2, 1);

    ({error, data} = await httpGet('/cl', session2));
    await clearLock(user2, user2[0]);
    strictEqual(error, true);
    strictEqual(data, w.IMPOSSIBLE_OPERATION);

    ({error, data} = await httpGet('/cl' + query({s: 'BTC'}), session2));
    await clearLock(user2, user2[0]);
    strictEqual(error, true);
    strictEqual(data, w.IMPOSSIBLE_OPERATION);

    ({error, data} = await httpGet('/cl' + query({s: 'ETHH'}), session2));
    await clearLock(user2, user2[0]);
    strictEqual(error, true);
    strictEqual(data, w.IMPOSSIBLE_OPERATION);

    ({error, data} = await httpGet('/cl' + query({s: 'ETH'}), session2));
    await clearLock(user2, user2[0]);
    strictEqual(data, w.IMPOSSIBLE_OPERATION);
    strictEqual(error, true);

    [session3, user3] = await createUser([w.free, 1e8]);
    ({error, data} = await httpGet('/o' + query({q: 1e8, p: 4e8, s: 'ETH', a: 'b', e: 'GTC'}), session));
    ({error, data} = await httpGet('/o' + query({q: 1e8 / 3, s: 'ETH', a: 's', e: 'MKT'}), session3));

    await wait(100);
}