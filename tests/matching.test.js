const {strictEqual} = require('assert');
const {ObjectId} = require('mongodb');
const w = require('../words');
const redis = require("../redis");
const {BTCSize} = require("./utilities");
const {openOrdersSize} = require("./utilities");
const {checkOrdersMongo} = require("./utilities");
const {clearCache} = require("./clearCache");
const {orderBookSize} = require("./utilities");
const {checkPos} = require("./utilities");
const {getProp} = require("./utilities");
const {createUser} = require("./utilities");
const {order} = require("./utilities");
const {httpGet, query} = require("./utilities");
const {checkBalance} = require("./utilities");
const {clearLock} = require("./utilities");
const {publish, wait} = require("../utilities/commons");

let error, data;
const orders = [], users = [], s = 'ETH', e = w.GTC;
let session, user, session2, user2;

(async () => {


    /*******case insertion bids******/
    await reset();

    await insertionCase(w.bids, w.buy);

    strictEqual(await getProp(getOrderId(0), w.status, true), w.opened);
    strictEqual(await getProp(getOrderId(0), w.fill), 1e8 * 0.5);

    strictEqual(await getProp(getOrderId(1), w.status, true), w.opened);
    strictEqual(await getProp(getOrderId(1), w.fill), 0);

    strictEqual(await getProp(getOrderId(2), w.status, true), w.opened);
    strictEqual(await getProp(getOrderId(2), w.fill), 0);

    strictEqual(await getProp(getOrderId(3), w.status, true), w.filled);
    strictEqual(await getProp(getOrderId(3), w.fill), 1e8 * 0.5);

    orders.push(await order({q: 1e8 * 0.5, s, a: 's', p: 1e8 * 1.5, e}, await createUser([w.free, 1e8], users)));
    await orderBookSize(s + w.bids, 3);
    await orderBookSize(s + w.asks, 1);
    /*******case insertion bids******/


    /*******case insertion asks******/
    await reset();

    await insertionCase(w.asks, w.sell);

    strictEqual(await getProp(getOrderId(0), w.status, true), w.opened);
    strictEqual(await getProp(getOrderId(0), w.fill), 0);

    strictEqual(await getProp(getOrderId(1), w.status, true), w.opened);
    strictEqual(await getProp(getOrderId(1), w.fill), 1e8 * 0.5);

    strictEqual(await getProp(getOrderId(2), w.status, true), w.opened);
    strictEqual(await getProp(getOrderId(2), w.fill), 0);

    strictEqual(await getProp(getOrderId(3), w.fill), 1e8 * 0.5);
    strictEqual(await getProp(getOrderId(3), w.status, true), w.filled);

    orders.push(await order({q: 1e8 * 0.5, s, a: 'b', p: 1e8 * 0.5, e}, await createUser([w.free, 1e8], users)));
    await orderBookSize(s + w.asks, 3);
    await orderBookSize(s + w.bids, 1);
    /*******case insertion asks******/


    /*******case range******/
    await reset();
    [session] = await createUser([w.free, 40e8]);
    for (let i = 0; i < 40; i++) await order({q: 1e8, s, a: 's', p: 1e8, e}, session);
    await orderBookSize(s + w.asks, 40);

    [session2] = await createUser([w.free, 50e8]);
    await order({q: 30e8, s, a: 'b', p: 1e8, e}, session2);
    await orderBookSize(s + w.asks, 10);

    await order({q: 20e8, s, a: 'b', p: 1e8, e}, session2);
    await orderBookSize(s + w.asks, 0);
    await orderBookSize(s + w.bids, 1);
    /*******case range******/


    /*******case post only******/
    await postOnlyCase('b', 's', w.bids);
    await postOnlyCase('s', 'a', w.asks);
    /*******case post only******/


    /*******case reduce only******/
    await reduceOnlyCase('b', 's', w.bids);
    await reduceOnlyCase('s', 'a', w.asks);
    /*******case reduce only******/


    /*******case auto liquidation******/
    await autoLiquidationCase('s', 'b', 1e8 * 0.9 - 1); // long
    await autoLiquidationCase('b', 's', 1e8 * 1.1 + 1); // short
    /*******case auto liquidation******/


    /*******case self-trade prevention******/
    await reset();
    user = await createUser([w.free, 1e8], users);
    await order({q: 1e8, p: 1e8, s, a: 'b', e}, user);
    ({error} = await order({q: 1e8, p: 1e8, s, a: 's', e}, user));
    strictEqual(error, false);
    await orderBookSize(s + w.asks, 1);
    await orderBookSize(s + w.bids, 0);
    /*******case self-trade prevention******/


    /*******case order not opened******/
    await reset();
    orders.push(await order({q: 1e8, s, a: 's', p: 1e8, e}, await createUser([w.free, 1e8], users)));
    await redis[users[0][1][0]].hsetAsync(getOrderId(0), w.status, w.cancelled);
    await orderBookSize(s + w.asks, 1);
    orders.push(await order({q: 1e8, s, a: 'b', p: 1e8, e}, await createUser([w.free, 1e8], users)));

    await orderBookSize(s + w.bids, 1);
    await orderBookSize(s + w.asks, 0);
    /*******case order not opened******/


    /*******case order partially filled******/
    await reset();
    orders.push(await order({q: 1e8, s, a: 'b', p: 1e8, e}, await createUser([w.free, 1e8], users)));
    await redis[users[0][1][0]].hsetAsync(getOrderId(0), w.fill, 1e8 * 0.5);
    await orderBookSize(s + w.bids, 1);
    orders.push(await order({q: 1e8, s, a: 's', p: 1e8, e}, await createUser([w.free, 1e8], users)));

    await orderBookSize(s + w.bids, 0);
    await orderBookSize(s + w.asks, 1);

    strictEqual(await getProp(getOrderId(0), w.fill), 1e8);
    strictEqual(await getProp(getOrderId(0), w.status, true), w.filled);
    strictEqual(await getProp(getOrderId(1), w.fill), 1e8 * 0.5);
    strictEqual(await getProp(getOrderId(1), w.status, true), w.opened);
    /*******case order partially filled******/


    /*******case maker reduce only******/
    await reset();
    orders.push(await order({q: 1e8, s, a: 'b', p: 1e8, e}, await createUser([w.free, 1e8], users)));
    orders.push(await order({q: 1e8, s, a: 's', p: 1e8, e}, await createUser([w.free, 1e8], users)));
    orders.push(await order({q: 1e8, s, a: 's', p: 1e8, e, [w.reduce]: true}, users[0]));
    strictEqual(orders[2].error, false);
    await orderBookSize(s + w.asks, 1);
    orders.push(await order({q: 1e8, s, a: 'b', p: 1e8, e, [w.reduce]: true}, users[1]));
    await orderBookSize(s + w.asks, 0);
    await orderBookSize(s + w.bids, 0);
    strictEqual(await getProp(users[0][1] + orders[2].data.id, w.status, true), w.filled);
    strictEqual(await getProp(users[1][1] + orders[3].data.id, w.status, true), w.filled);

    for (let i = 0; i < 3; i++) {
        await reset();
        await createUser([w.free, 1e8], users);
        await redis[users[0][1][0]].hsetAsync(users[0][1], w.positions + s, JSON.stringify({
            q: i === 1 ? -1e8 : 1e8,
            p: 1e8
        }));
        orders.push(await order({
            q: 1e8,
            s,
            a: i === 1 ? w.buy : w.sell,
            p: 1e8,
            e,
            [w.reduce]: true
        }, users[0]));
        strictEqual(orders[0].error, false);
        await orderBookSize(s + (i === 1 ? w.bids : w.asks), 1);
        if (i) {
            await redis[users[0][1][0]].hsetAsync(users[0][1], w.positions + s, JSON.stringify({
                q: i === 1 ? 1e8 : -1e8,
                p: 1e8
            }));
        } else {
            await redis[users[0][1][0]].hdelAsync(users[0][1], w.positions + s);
        }
        orders.push(await order({
            q: 1e8,
            s,
            a: i === 1 ? w.sell : w.buy,
            p: 1e8,
            e
        }, await createUser([w.free, 1e8], users)));
        if (i === 1) {
            await orderBookSize(s + w.asks, 1);
            await orderBookSize(s + w.bids, 0);
        } else {
            await orderBookSize(s + w.asks, 0);
            await orderBookSize(s + w.bids, 1);
        }
        strictEqual(await getProp(getOrderId(0), w.status, true), w.cancelled);
    }
    /*******case maker reduce only******/


    /*******case auto liquidation maker @ execution******/
    for (const side of [w.sell, w.buy]) {
        const p = side === w.sell ? 1e8 * 0.5 : 1e8 * 1.5;
        await reset();
        orders.push(await order({
            q: 1e8,
            s,
            a: side,
            p,
            e
        }, await createUser([w.free, 1e8], users)));
        await createUser([w.free, 1e8], users);
        await redis[users[0][1][0]].hsetAsync(users[0][1], w.positions + s, JSON.stringify({
            q: side === w.sell ? 10e8 : -10e8,
            p: 1e8
        }));
        await redis[users[0][1][0]].lpushAsync(users[0][1] + w.borrowed, JSON.stringify({
            [w.timestamp]: Date.now(),
            [w.quantity]: 9e8,
            [w.price]: 0.06 * 1e8,
            [w.order]: [null, ObjectId().toString()]
        }));
        orders.push(await order({
            q: 1e8,
            s,
            a: side === w.sell ? w.buy : w.sell,
            p,
            e
        }, await createUser([w.free, 1e8], users)));
        await orderBookSize(s + w.asks, side === w.sell ? 0 : 1);
        await orderBookSize(s + w.bids, side === w.sell ? 1 : 0);
    }
    /*******case auto liquidation maker @ execution******/


    /*******Cancel auto liquidation maker if place an order in an empty book but didn't lend yet******/
    await clearCache();
    await order({q: 10e8, p: 0.05 * 1e8, s: 'BTC', a: 's', e: 'GTC'}, await createUser([w.fundingFree, 10e8]));
    [session, user] = await createUser([w.free, 1e8]);
    await order({q: 2e8, p: 1e8, s: 'GOLD', a: 'b', e: 'GTC'}, session);
    await order({q: 2e8, p: 1e8, s: 'GOLD', a: 's', e: 'GTC'}, await createUser([w.free, 1e8]));
    ({error, data} = await order({q: 2e8, p: 1e8 / 3, s: 'GOLD', a: 's', e: 'GTC'}, session));
    if (!error) {
        await openOrdersSize(user, 1);
        await order({q: 1e8, p: 1e8 / 3, s: 'GOLD', a: 'b', e: 'GTC'}, await createUser([w.free, 1e8]));
        strictEqual(await getProp(user + data.id, w.status, true), w.cancelled);
        await openOrdersSize(user, 0);
        await orderBookSize('GOLD' + w.bids, 1);
        await orderBookSize('GOLD' + w.asks, 0);
    }
    /*******Cancel auto liquidation maker if place an order in an empty book but didn't lend yet******/


    /*******case using counterPart to open or increase a position******/
    await reset();
    orders.push(await order({q: 1e8, s, a: 'b', p: 1e8, e}, await createUser([w.free, 1e8], users)));
    orders.push(await order({q: 1e8, s, a: 's', p: 1e8 / 2, e}, await createUser([w.free, 1e8], users)));
    await checkPos(users[0][1], s, {q: 1e8, p: 1e8, sq: 1e8, pnl: 0});
    await checkPos(users[1][1], s, {q: -1e8, p: 1e8, sq: -1e8, pnl: 0});
    orders.push(await order({q: 1e8, s, a: 's', p: 100e8 - 1, e}, users[0]));
    orders.push(await order({q: 1e8, s, a: 'b', p: 1e8, e}, users[1]));
    await order({q: 1e8, s: 'BTC', a: 's', p: 1e8 * 0.04, e}, await createUser([w.fundingFree, 1e8]));
    orders.push(await order({q: 1e8, s, a: 's', p: 1e8, e}, users[0]));
    await checkPos(users[0][1], s, null);
    await checkPos(users[1][1], s, null);
    strictEqual(await getProp(users[0][1] + orders[2].data.id, w.status, true), w.opened);
    strictEqual(await getProp(users[0][1] + orders[2].data.id, w.counterPart), 1e8);
    orders.push(await order({q: 1e8 / 1000, s, a: 'b', p: 100e8 - 1, e}, await createUser([w.free, 1e8], users)));
    await orderBookSize(s + w.asks, 0);
    await orderBookSize(s + w.bids, 1);
    strictEqual(await getProp(users[0][1] + orders[2].data.id, w.status, true), w.cancelled);
    strictEqual(await getProp(users[0][1] + orders[2].data.id, w.counterPart), 0);
    strictEqual(await getProp(users[0][1] + orders[2].data.id, w.fill), 0);
    await BTCSize(users[0][1], 0);
    /*******case using counterPart to open or increase a position******/


    /*******case short and buy market at entry * 2 or more******/
    await reset();
    await matchOrder(1e8, 1e8);
    orders.push(await order({q: 1e8, s, a: 's', p: 10e8, e}, users[1]));
    orders.push(await order({q: 1e8, s, a: 'b', e: 'MKT'}, users[0]));
    strictEqual(await getProp(users[0][1] + orders[3].data.id, w.status, true), w.filled);
    strictEqual(await getProp(users[0][1] + orders[3].data.id, w.fill), 1e8 / 10);
    await checkPos(users[0][1], s, null);
    await checkPos(users[1][1], s, {q: 1e8 * 0.9, p: 1e8, sq: 1e8, pnl: 0.1 * (10e8 - 1e8)});
    /*******case short and buy market at entry * 2 or more******/


    /*******case short and buy market at more than entry * 2 with more quantity than the opened position******/
    for (const q of [1e8 / 2, 1e8 * 2]) {
        await reset();
        await matchOrder(1e8, 1e8, 2e8);
        orders.push(await order({q: 1e8, s, a: 's', p: 5e8, e}, users[1]));
        orders.push(await order({q, s, a: 'b', e: 'MKT'}, users[0]));
        if (q < 1e8) {
            await checkPos(users[0][1], s, {q: -1e8 / 2, p: 1e8, sq: -1e8, pnl: -1e8 / 2});
            await checkPos(users[1][1], s, {q: 1e8 * 0.9, p: 1e8, sq: 1e8, pnl: 0.4 * 1e8});
        } else {
            await checkPos(users[0][1], s, null);
            await checkPos(users[1][1], s, {q: 1e8 - 1e8 / 5, p: 1e8, sq: 1e8, pnl: 0.2 * (5e8 - 1e8)});
        }
        strictEqual(await getProp(users[0][1] + orders[3].data.id, w.status, true), w.filled);
        strictEqual(await getProp(users[0][1] + orders[3].data.id, w.fill), q < 1e8 ? q / 5 : 1e8 / 5);
    }
    /*******case short and buy market at more than entry * 2 with more quantity than the opened position******/


    /*******case short and buy market at more than entry * 2 with more quantity than the opened position - qty calculation multiple fill******/
    await reset();
    [session, user] = await createUser([w.free, 1e8]);
    await order({q: 1e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session);
    await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, await createUser([w.free, 1e8]));
    await checkBalance(user, w.free, 0, w.locked, 1e8);
    await order({q: 0.5e8, p: 1.5e8, s: 'ETH', a: 's', e: w.GTC}, await createUser([w.free, 1e8]));
    await order({q: 0.5e8, p: 3e8, s: 'ETH', a: 's', e: w.GTC}, await createUser([w.free, 1e8]));
    ({data} = await order({q: 10e8, s: 'ETH', a: 'b', e: w.MKT}, session));
    strictEqual(data[w.quantity], Math.round(2 / 3 * 1e8));
    strictEqual(data[w.fill], Math.round(2 / 3 * 1e8));
    strictEqual(data[w.status], w.filled);
    await checkBalance(user, w.free, 0.25e8, w.locked, 0);
    /*******case short and buy market at more than entry * 2 with more quantity than the opened position - qty calculation multiple fill******/


    /*******case infinite pnl while shorting*******/
    await reset();
    await matchOrder(1e8, 1e8);
    await orderBookSize(s + w.asks, 0);
    await orderBookSize(s + w.bids, 0);
    orders.push(await order({q: 1e8, s, a: 's', p: 100e8 - 1, e}, users[1]));
    await orderBookSize(s + w.asks, 1);
    await orderBookSize(s + w.bids, 0);
    orders.push(await order({q: 1e8, s, a: 'b', e: 'MKT'}, users[0]));
    await orderBookSize(s + w.asks, 1);
    await orderBookSize(s + w.bids, 0);

    strictEqual(await getProp(users[1][1] + orders[2].data.id, w.fill), 1e8 / 100);
    strictEqual(await getProp(users[1][1] + orders[2].data.id, w.status, true), w.opened);
    strictEqual(await getProp(users[0][1] + orders[3].data.id, w.fill), 1e8 / 100);
    strictEqual(await getProp(users[0][1] + orders[3].data.id, w.status, true), w.filled);

    await checkPos(users[0][1], s, null);
    await checkPos(users[1][1], s, {q: 1e8 - 1e8 / 100, p: 1e8, sq: 1e8, pnl: 1e8 - 1e8 / 100});
    await orderBookSize(s + w.asks, 1);
    await orderBookSize(s + w.bids, 0);
    /*******case infinite pnl while shorting*******/


    /*******Test classic fees******/
    await reset();
    let makerFee = -0.05 / 100, takerFee = 0.05 / 100;
    publish({[w.fee]: [makerFee, takerFee]}, 0);
    await matchOrder(1e8, 1e8, 2e8);
    strictEqual(await getProp(getOrderId(0), w.fee), 1e8 * makerFee);
    strictEqual(await getProp(getOrderId(1), w.fee), 1e8 * takerFee);
    strictEqual(await getProp(users[0][1], w.free), 100050000);
    strictEqual(await getProp(users[1][1], w.free), 99950000);
    /*******Test classic fees******/


    /*******Test inverse fees when taker discovers hidden order******/
    await reset();
    makerFee = -0.04 / 100;
    takerFee = 0.05 / 100;
    publish({[w.fee]: [makerFee, takerFee]}, 0);
    orders.push(await order({q: 1e8, s, a: 's', p: 1e8, e, h: true}, await createUser([w.free, 2e8], users)));
    orders.push(await order({q: 1e8, s, a: 'b', p: 1e8, e}, await createUser([w.free, 3e8], users)));
    strictEqual(await getProp(getOrderId(0), w.fee), 1e8 * takerFee);
    strictEqual(await getProp(users[0][1], w.free), 1e8 - 1e8 * takerFee);
    strictEqual(await getProp(users[1][1], w.free), 2e8 - 1e8 * makerFee);
    strictEqual(await getProp(getOrderId(1), w.fee), 1e8 * makerFee);
    /*******Test inverse fees when taker discovers hidden order******/


    /*******Test classic fee and inverse fees when taker discovers hidden order******/
    await reset();
    makerFee = -0.01 / 100;
    takerFee = 0.02 / 100;
    publish({[w.fee]: [makerFee, takerFee]}, 0);
    orders.push(await order({q: 1e8 / 2, s, a: 's', p: 1e8, e, h: true}, await createUser([w.free, 2e8], users)));
    orders.push(await order({q: 1e8 / 2, s, a: 's', p: 1e8, e}, users[0]));
    orders.push(await order({q: 1e8, s, a: 'b', p: 1e8, e}, await createUser([w.free, 2e8], users)));
    await openOrdersSize(users[0][1], 0);
    await openOrdersSize(users[1][1], 0);
    const fee = 1e8 / 2 * (makerFee + takerFee);
    strictEqual(await getProp(users[1][1] + orders[2].data.id, w.fee), fee);
    strictEqual(await getProp(users[0][1] + orders[0].data.id, w.status, true), w.filled);
    strictEqual(await getProp(users[0][1] + orders[1].data.id, w.status, true), w.filled);
    await checkBalance(users[1][1], w.free, 1e8 - fee, w.locked, 1e8);
    strictEqual(await getProp(users[0][1], w.free), 1e8 - fee);
    /*******Test classic fee and inverse fees when taker discovers hidden order******/


    /*******case short and buy at entry * 2******/
    await reset();
    await matchOrder(1e8 / 2, 1e8);
    orders.push(await order({q: 1e8 / 2, s, a: 'b', p: 2e8 + 1, e}, users[0]));
    strictEqual(orders[2].error, true);
    strictEqual(orders[2].data, w.USE_MARKET_OR_STOP_ORDER_INSTEAD);
    /*******case short and buy at entry * 2******/


    /*****Transfer should reduce margin at execution*****/
    for (let i = 0; i < 2; i++) {
        await clearCache();
        await order({q: 1e8, s: 'BTC', a: 's', p: 0.05 * 1e8, e: 'GTC'}, await createUser([w.fundingFree, 10e8]));
        [session, user] = await createUser([w.free, 1e8, w.fundingFree, 1e8]);
        await order({q: 1e8, s: 'ETH', a: 'b', p: 2e8, e: 'GTC'}, session);
        if (i) await httpGet('/t' + query({q: 1e8, from: w.funding}), session);
        await order({q: 1e8, s: 'ETH', a: 's', p: 2e8, e: 'GTC'}, await createUser([w.free, 10e8]));
        await wait(500);
        if (i) {
            await checkBalance(user, w.free, 0, w.locked, 2e8, w.fundingFree, 0, w.margin, 0);
            await BTCSize(user, 0);
        } else {
            await checkBalance(user, w.free, 0, w.locked, 1e8, w.fundingFree, 1e8, w.margin, 1e8);
            await BTCSize(user, 1);
        }
    }
    /*****Transfer should reduce margin at execution*****/


    /*******case not supposed to borrow******/
    await reset();
    orders.push(await order({q: 1e8, s, a: 'b', p: 1e8, e}, await createUser([w.free, 1e8], users)));
    orders.push(await order({q: 1e8, s: 'GOLD', a: 'b', p: 1e8, e}, users[0][0]));
    await checkBalance(users[0][1], w.free, 0, w.locked, 1e8, w.margin, 1e8, w.counter + w.order, 2);
    orders.push(await order({q: 1e8, s: 'GOLD', a: 's', p: 1e8, e}, await createUser([w.free, 1e8], users)));
    await checkBalance(users[0][1], w.free, 0, w.locked, 1e8, w.margin, 1e8);
    await wait(100);
    await checkPos(users[0][1], 'GOLD', {q: 1e8, p: 1e8, sq: 1e8, pnl: 0});
    await BTCSize(users[0][1], 0);
    /*******case not supposed to borrow******/


    /*******case close position with borrowed funds******/
    const getPNL = (long, q, p, c) => {
        if (long) return q * (c - p) / 1e8;
        else return q * (c - p) / 1e8 * -1;
    };
    for (const [a, a1] of [['b', 's'], ['s', 'b']]) {
        for (const p of [1e8, 1e8 / 2, 1e8 * 1.5]) {
            await reset();
            await order({q: 10e8, s: 'BTC', a: 's', p: 0.05 * 1e8, e}, await createUser([w.free, 1e8], users));
            orders.push(await order({q: 1e8, s, a: a, p: 1e8, e}, await createUser([w.free, 1e8], users)));
            orders.push(await order({q: 1e8, s, a: a1, p: 1e8, e}, await createUser([w.free, 1e8], users)));
            orders.push(await order({q: 1e8, s, a: a1, p: a === w.buy ? 100e8 - 1 : 1, e}, users[1][0]));
            orders.push(await order({q: 1e8, s, a: a1, p, e}, users[1][0]));
            orders.push(await order({q: 1e8, s, a: a, p, e}, users[2][0]));
            await wait(100);
            await BTCSize(users[1][1], 0);
            await checkBalance(users[1][1], w.free, 1e8 + getPNL(a === w.buy, 1e8, 1e8, p), w.locked, 0, w.margin, 0);
        }
    }
    /*******case close position with borrowed funds******/


    /*******case not enough funds to borrow for maker******/
    await reset();
    orders.push(await order({q: 1e8, s, a: 'b', p: 2e8, e}, await createUser([w.free, 1e8], users)));
    await checkBalance(users[0][1], w.free, 0, w.locked, 1e8, w.margin, 1e8);
    orders.push(await order({q: 1e8, s, a: 's', p: 2e8, e}, await createUser([w.free, 1e8], users)));
    strictEqual(await getProp(getOrderId(0), w.status, true), w.marginCancelled);
    await checkBalance(users[0][1], w.free, 1e8, w.locked, 0, w.margin, 0);
    await checkBalance(users[1][1], w.free, 0, w.locked, 1e8, w.margin, 1e8);

    await reset();
    [session, user] = await createUser([w.free, 0.01e8]);
    await order({q: 100000000, p: 1721776, s: 'BLX', a: 's', e: w.GTC}, session);
    for (const f of ["0.01857973@0.01721776", "0.10110807@0.01721776", "0.06359165@0.01721776", "0.11561657@0.01721776", "0.09794082@0.01721776", "0.10850677@0.01721776", "0.10850677@0.01721776"]) {
        let [q, p] = f.split('@');
        q *= 1e8;
        p *= 1e8;
        await order({q, p, s: 'BLX', a: 'b', e: w.GTC}, await createUser([w.free, 0.1e8]));
    }
    await checkBalance(user, w.margin, 0, w.free, 129912, w.locked, 870088);
    /*******case not enough funds to borrow******/


    /****try to create an opposite high leverage position****/
    await clearCache();
    await order({q: 10e8, p: 1e8 * 0.05, s: 'BTC', a: 's', e: w.GTC}, await createUser([w.fundingFree, 10e8]));
    [session, user] = await createUser([w.free, 1e8]);
    await order({q: 2e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session);
    await order({q: 2e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, await createUser([w.free, 10e8]));
    ({error, data} = await order({q: 5e8, p: 1e8 * 0.55, s: 'ETH', a: 's', e: w.GTC}, session)); // maker
    strictEqual(error, true);
    strictEqual(data, w.INSUFFICIENT_BALANCE);
    await clearLock(user, user[0]);
    await order({q: 5e8, p: 1e8 * 0.55, s: 'ETH', a: 'b', e: w.GTC}, await createUser([w.free, 10e8]));
    ({error, data} = await order({q: 5e8, s: 'ETH', a: 's', e: w.MKT}, session)); // taker
    strictEqual(error, true);
    strictEqual(data, w.INSUFFICIENT_BALANCE);
    /****try to create an opposite high leverage position****/


    /****Create an opposite position****/
    await clearCache();
    await order({q: 10e8, p: 1e8 * 0.04, s: 'BTC', a: 's', e: w.GTC}, await createUser([w.fundingFree, 10e8]));
    [session, user] = await createUser([w.free, 1e8]);
    await order({q: 2e8, p: 1e8, s: 'BLX', a: 'b', e: w.GTC}, session);
    await order({q: 2e8, p: 1e8, s: 'BLX', a: 's', e: w.GTC}, await createUser([w.free, 10e8]));
    await order({q: 5e8, p: 0.9e8, s: 'BLX', a: 'b', e: w.GTC}, await createUser([w.free, 10e8]));
    await order({q: 5e8, s: 'BLX', a: 's', e: w.MKT}, session);
    await wait(1000);
    await checkPos(user, 'BLX', {q: -3e8, p: 0.9e8, sq: -3e8, pnl: 0});
    await checkBalance(user, w.free, 0, w.locked, 0.8e8, w.margin, 1.9e8);
    const borrow = await redis[user[0]].lrangeAsync(user + w.borrowed, 0, -1);
    strictEqual(borrow.length, 2);
    strictEqual(JSON.parse(borrow[0])[w.quantity], 1e8);
    strictEqual(JSON.parse(borrow[1])[w.quantity], 0.9e8);
    /****Create an opposite position****/


    /****increase a leveraged position at a price below entry price****/
    for (const [a, a1] of [['b', 's'], ['s', 'b']]) {
        await clearCache();
        await order({q: 10e8, p: 1e8 * 0.05, s: 'BTC', a: 's', e: w.GTC}, await createUser([w.fundingFree, 10e8]));
        [session, user] = await createUser([w.free, 1e8]);
        await order({q: 1e8, p: 2e8, s: 'GOLD', a, e: w.GTC}, session);
        await order({q: 1e8, p: 2e8, s: 'GOLD', a: a1, e: w.GTC}, await createUser([w.free, 10e8]));
        await order({q: 5e8, p: a === 'b' ? 1e8 * 0.5 : 1e8 * 1.5, s: 'GOLD', a, e: w.GTC}, session);
        await orderBookSize('GOLD' + (a === 'b' ? w.bids : w.asks), 1);
        await openOrdersSize(user, 1);
    }
    /****increase a leveraged position at a price below entry price****/


    /****do not borrow funds if not needed****/
    await clearCache();
    [session, user] = await createUser([w.free, 1e8, w.fundingFree, 4e8]);
    ({error} = await order({q: 4e8, p: 0.05 * 1e8, s: 'BTC', a: 's', e: w.GTC}, session));
    strictEqual(error, false);
    ({error} = await order({q: 1e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session));
    strictEqual(error, false);
    [session2, user2] = await createUser([w.free, 0, w.locked, 19388773, w.margin, 106145747]);
    ({error, data} = await order({q: 1e8 * 0.1, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session2));
    strictEqual(error, false);
    await wait(500);
    await BTCSize(user2, 0);
    /****do not borrow funds if not needed****/


    process.exit(0);
})();

async function autoLiquidationCase(a1, a2, p) {
    await reset();
    orders.push(await order({
        q: 10e8,
        p: 0.05 * 1e8,
        s: 'BTC',
        a: 's',
        e
    }, await createUser([w.fundingFree, 10e8], users)));
    orders.push(await order({q: 10e8, p: 1e8, s, a: a1, e}, await createUser([w.free, 10e8], users)));
    orders.push(await order({q: 10e8, p: 1e8, s, a: a2, e}, await createUser([w.free, 1e8], users)));

    user = users[2][1];
    strictEqual(await getProp(user, w.free), 0);
    strictEqual(await getProp(user, w.locked), 1e8);
    strictEqual(await getProp(user, w.margin), 9e8);

    if (a2 === w.buy) await checkPos(user, s, {q: 10e8, p: 1e8, sq: 10e8, pnl: 0});
    else await checkPos(user, s, {q: -10e8, p: 1e8, sq: -10e8, pnl: 0});

    await orderBookSize(s + w.asks, 0);
    await orderBookSize(s + w.bids, 0);

    await order({q: 1e8, p, s, a: a2, e}, await createUser([w.free, 1e8], users));
    await orderBookSize(s + (a2 === w.buy ? w.bids : w.asks), 1);
    ({error, data} = await order({q: 10e8, p, s, a: a1, e}, users[2]));
    strictEqual(error, true);
    strictEqual(data, w.AUTO_LIQUIDATION_FORBIDDEN_TO_PROTECT_LENDERS);
}

async function reduceOnlyCase(a1, a2, obSide) {
    await onlyCase(a1, a2, obSide, w.reduce, w.ORDER_CANCELLED_REDUCE_ONLY);
}

async function postOnlyCase(a1, a2, obSide) {
    await onlyCase(a1, a2, obSide, w.post, w.ORDER_CANCELLED_POST_ONLY);
}

async function onlyCase(a1, a2, obSide, p, msg) {
    await reset();
    await order({q: 1e8, s, a: a1, p: 1e8, e}, await createUser([w.free, 1e8]));
    ({error, data} = await order({q: 1e8, s, a: a2, p: 1e8, e, [p]: true}, await createUser([w.free, 1e8])));
    strictEqual(error, true);
    strictEqual(data, msg);
    await orderBookSize(s + obSide, 1);
}

async function insertionCase(side, a) {
    orders.push(await order({q: 1e8, s, a, p: 1e8, e}, await createUser([w.free, 1e8], users)));
    await orderBookSize(s + side, 1);

    orders.push(await order({q: 1e8, s, a, p: 1e8 - 1, e}, await createUser([w.free, 1e8], users)));
    await orderBookSize(s + side, 2);

    orders.push(await order({q: 1e8, s, a, p: 1e8, e}, await createUser([w.free, 1e8], users)));
    await orderBookSize(s + side, 3);

    orders.push(await order({
        q: 1e8 * 0.5,
        s,
        a: a === w.sell ? w.buy : w.sell,
        p: 1e8 * (a === w.sell ? 1.5 : 0.5),
        e: w.GTC
    }, await createUser([w.free, 1e8], users, true)));

    await orderBookSize(s + side, 3);
    await checkOrdersMongo(users[3][1], 1);
}

async function reset() {
    await clearCache();
    users.length = 0;
    orders.length = 0;
}

function getOrderId(i) {
    return users[i][1] + orders[i].data.id;
}

async function matchOrder(q, p, free) {
    orders.push(await order({q: q || 1e8, s, a: 's', p: p || 1e8, e}, await createUser([w.free, free || 1e8], users)));
    orders.push(await order({q: q || 1e8, s, a: 'b', p: p || 1e8, e}, await createUser([w.free, free || 1e8], users)));
}