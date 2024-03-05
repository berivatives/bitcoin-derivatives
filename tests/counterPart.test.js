const {strictEqual} = require('assert');
const w = require('../words');
const {clearCache} = require("./clearCache");
const {order, createUser} = require("./utilities");
const {checkBalance} = require("./utilities");
const {checkPos} = require("./utilities");
const {openOrdersSize} = require("./utilities");
const {getProp} = require("./utilities");
const {httpGet, query} = require("./utilities");

let data, session, user;

(async () => {

    /****Classic cases****/
    for (const [a, a1, l, l1] of [["b", "s", w.sellUsed, w.buyUsed], ["s", "b", w.buyUsed, w.sellUsed]]) {
        await clearCache();
        [session, user] = await createUser([w.free, 1e8]);
        await order({q: 1e8, p: 1e8, s: 'ETH', a, e: w.GTC}, session);
        await order({q: 1e8, p: 1e8, s: 'ETH', a: a1, e: w.GTC}, await createUser([w.free, 1e8]));
        ({data} = await order({q: 1e8, p: a === w.sell ? 1.5e8 : 0.5e8, s: 'ETH', a: a, e: w.GTC}, session));
        strictEqual(data[w.counterPart], 0);
        await checkBalance(user, 'ETH' + l, 0, 'ETH' + l1, 0);
        ({data} = await order({q: 0.5e8, p: 1e8, s: 'ETH', a: a1, e: w.GTC}, session));
        strictEqual(data[w.counterPart], 0.5e8);
        await checkBalance(user, 'ETH' + l, 0.5e8, 'ETH' + l1, 0);
        ({data} = await order({q: 1.5e8, p: 1e8, s: 'ETH', a: a1, e: w.GTC}, session));
        strictEqual(data[w.counterPart], 0.5e8);
        await checkBalance(user, 'ETH' + l, 1e8, 'ETH' + l1, 0);
        await httpGet('/c' + query({[w.id]: data[w.id]}), session);
        await checkBalance(user, 'ETH' + l, 0.5e8, 'ETH' + l1, 0);
        await order({q: 1e8, p: 1e8, s: 'ETH', a: a, e: w.GTC}, await createUser([w.free, 1e8]));
        await checkBalance(user, 'ETH' + l, 0, 'ETH' + l1, 0);
        await checkPos(user, 'ETH', {q: a === w.sell ? -0.5e8 : 0.5e8, p: 1e8, sq: a === w.sell ? -1e8 : 1e8, pnl: 0});
    }
    /****Classic cases****/


    /****Maker filled twice and the second with CP create an opposite position****/
    for (let i = 0; i < 2; i++) {
        await clearCache();
        if (i) await order({q: 4e8, p: 0.05 * 1e8, s: 'BTC', a: 's', e: w.GTC}, await createUser([w.fundingFree, 4e8]));
        [session, user] = await createUser([w.free, 1e8]);
        await order({q: 1e8, p: 1e8, s: 'ETH', a: "b", e: w.GTC}, session);
        await order({q: 1e8, p: 1e8, s: 'ETH', a: "s", e: w.GTC}, await createUser([w.free, 1e8]));
        ({data} = await order({q: 1e8, p: 1.5e8, s: 'ETH', a: "s", e: w.GTC}, session));
        await order({q: 1e8, p: 1.25e8, s: 'ETH', a: "s", e: w.GTC}, session);
        await order({q: 10e8, s: 'ETH', a: "b", e: w.MKT}, await createUser([w.free, 10e8]));
        await openOrdersSize(user, 0);
        strictEqual(await getProp(user + data[w.id], w.status, true), i ? w.filled : w.marginCancelled);
        await checkPos(user, 'ETH', !i ? null : {q: -1e8, p: 1.5e8, sq: -1e8, pnl: 0});
        if (i) await checkBalance(user, w.free, 0, w.locked, 1.25e8, w.margin, 0.25e8, "ETH" + w.buyUsed, 0, "ETH" + w.sellUsed, 0);
        else await checkBalance(user, w.free, 1.25e8, w.locked, 0, w.margin, 0, "ETH" + w.buyUsed, 0, "ETH" + w.sellUsed, 0);
    }
    /****Maker filled twice and the second with CP create an opposite position****/

    process.exit(0);
})();