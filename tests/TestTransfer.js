const {strictEqual} = require('assert');
const w = require('../words');
const {clearCache} = require("./clearCache");
const {wait} = require("../utilities/commons");
const {httpGet, query} = require("./utilities");
const redis = require("../redis");
const mongo = require("../mongo");
const {checkBalance} = require("./utilities");
const {BTCSize} = require("./utilities");
const {openOrdersSize} = require("./utilities");
const {getCluster} = require("../utilities/commons");
const {genRandomString} = require("../utilities/hash");
const {clearLock, createUser, getProp} = require("./utilities");

let error, data, session, user;

(async () => {
    await clearCache();


    /*****Transfer failures*****/
    [session, user] = await createUser();
    ({error, data} = await httpGet('/t', session));
    strictEqual(error, true);
    strictEqual(data, w.MISSING_AMOUNT);
    await clearLock(user + w.transfer, user[0]);

    ({error, data} = await httpGet('/t' + query({q: 1e8}), session));
    strictEqual(error, true);
    strictEqual(data, w.IMPOSSIBLE_OPERATION);
    await clearLock(user + w.transfer, user[0]);
    /*****Transfer failures*****/


    /*****Classic transfers*****/
    await redis[user[0]].hmsetAsync(user, w.free, 1e8, w.fundingFree, 1e8);

    ({error, data} = await httpGet('/t' + query({q: 1e8, from: w.funding}), session));
    strictEqual(error, false);
    strictEqual(data, w.TRANSFER_COMPLETED);
    await clearLock(user + w.transfer, user[0]);
    strictEqual(await getProp(user, w.free), 2e8);
    strictEqual(await getProp(user, w.fundingFree), 0);

    ({error, data} = await httpGet('/t' + query({q: 2e8, from: w.margin}), session));
    strictEqual(error, false);
    strictEqual(data, w.TRANSFER_COMPLETED);
    await clearLock(user + w.transfer, user[0]);
    strictEqual(await getProp(user, w.free), 0);
    strictEqual(await getProp(user, w.fundingFree), 2e8);

    ({error, data} = await httpGet('/t' + query({q: 2e8, from: w.margin}), session));
    strictEqual(error, true);
    strictEqual(data, w.IMPOSSIBLE_OPERATION);
    await clearLock(user + w.transfer, user[0]);
    /*****Classic transfers*****/


    /*****Return borrowed BTC after transfer from funding*****/
    for (const q of [1e8, 1e8 / 2]) {
        await clearCache();
        [session, user] = await createUser();
        await redis[user[0]].hmsetAsync(user, w.free, 0, w.fundingFree, 2e8);
        ({data} = await httpGet('/o' + query({q: 2e8, p: 0.06 * 1e8, s: 'BTC', a: 's', e: 'GTC'}), session));
        await openOrdersSize(user, 1);
        strictEqual(await getProp(user, w.free), 0);
        strictEqual(await getProp(user, w.fundingFree), 0);

        const [session2, user2] = await createUser([w.free, 2e8]);
        await httpGet('/o' + query({q: 1e8, p: 2e8, s: 'ETH', a: 's', e: 'GTC'}), session2);
        await openOrdersSize(user2, 1);
        strictEqual(await getProp(user2, w.free), 0);
        strictEqual(await getProp(user2, w.fundingFree), 0);

        const [session3, user3] = await createUser([w.free, 1e8, w.fundingFree, 1e8]);
        await httpGet('/o' + query({q: 1e8, p: 2e8, s: 'ETH', a: 'b', e: 'GTC'}), session3);
        await openOrdersSize(user2, 0);
        await openOrdersSize(user3, 0);
        strictEqual(await getProp(user3, w.free), 0);
        strictEqual(await getProp(user3, w.locked), 1e8);
        strictEqual(await getProp(user3, w.margin), 1e8);
        strictEqual(await getProp(user3, w.fundingFree), 1e8);

        await wait(50);

        await BTCSize(user, 0);
        await BTCSize(user2, 0);
        await BTCSize(user3, 1);

        await httpGet('/t' + query({q, from: w.funding}), session3);

        await wait(100);

        strictEqual(await getProp(user + data[w.id], w.counterPart), q);

        if (q === 1e8) {
            await BTCSize(user3, 0);
            await checkBalance(user3, w.locked, 2e8, w.margin, 0);
            data = await getProp(user, w.fundingFree);
            strictEqual(data > 1e8 && data < 1e8 + 20, true);
        } else {
            await BTCSize(user3, 1);
            data = JSON.parse(await redis[user3[0]].lindexAsync(user3 + w.borrowed, 0));
            strictEqual(data[w.quantity], 1e8 * 0.5);
            await checkBalance(user3, w.locked, 1e8 * 1.5, w.margin, 1e8 * 0.5);
            data = await getProp(user, w.fundingFree);
            strictEqual(data > 1e8 / 2 && data < 1e8 / 2 + 10, true);
        }
    }
    /*****Return borrowed BTC after transfer from funding*****/


    /*****Transfer from the parent account to a sub account*****/
    await clearCache();
    [session, user] = await createUser([w.free, 3e8, w.fundingFree, 1e8]);
    const email = "toto", subAccountId = "" + Date.now(), subAccountCluster = getCluster(email);
    await redis[user[0]].hsetAsync(user + w.subAccount, email, JSON.stringify({id: subAccountId}));
    ({error, data} = await httpGet('/t' + query({q: 2e8, from: w.margin, to: email + "nope"}), session));
    strictEqual(error, true);
    strictEqual(data, w.UNKNOWN_ACCOUNT);
    await clearLock(user + w.transfer, user[0]);
    ({error, data} = await httpGet('/t' + query({q: 2e8, from: w.margin, to: email}), session));
    strictEqual(error, false);
    strictEqual(data, w.TRANSFER_COMPLETED);
    await wait(100);
    strictEqual(await getProp(user, w.fundingFree), 1e8);
    strictEqual(await getProp(user, w.free), 1e8);
    strictEqual(await getProp(subAccountId, w.fundingFree), 0);
    strictEqual(await getProp(subAccountId, w.free, false, subAccountCluster), 2e8);
    strictEqual(await redis[user[0]].llenAsync(user + w.balance), 1);
    data = JSON.parse(await redis[user[0]].lindexAsync(user + w.balance, 0));
    strictEqual(data[1], "Transfer to " + (email ? ("sub account " + email) : "parent account") + " wallet");
    strictEqual(data[2], -2e8);
    strictEqual(await redis[subAccountCluster].llenAsync(subAccountId + w.balance), 1);
    data = JSON.parse(await redis[subAccountCluster].lindexAsync(subAccountId + w.balance, 0));
    strictEqual(data[1], "Transfer from " + (!email ? ("sub account " + email) : "parent account") + " wallet");
    strictEqual(data[2], 2e8);
    /*****Transfer from the parent account to a sub account*****/


    /*****Transfer from a sub account to the parent account*****/
    const sessionSubAccount = subAccountCluster + genRandomString(128);
    await redis[w.minus + subAccountCluster].set("session" + sessionSubAccount, subAccountId);
    await redis[subAccountCluster].hincrbyAsync(subAccountId, w.fundingFree, 1e8);
    await redis[subAccountCluster].hsetAsync(subAccountId, w.email, email, w.subAccount, user, w.subAccount + w.cluster, "1");
    let i = 0;
    for (const {from} of [{from: w.margin}, {from: w.funding}]) {
        await clearLock(subAccountId + w.transfer, subAccountCluster);
        ({data, error} = await httpGet('/t' + query({q: 1e8, from, to: w.parentAccount}), sessionSubAccount));
        strictEqual(error, false);
        await wait(100);
        strictEqual(await getProp(subAccountId, w.free, false, subAccountCluster), 1e8);
        strictEqual(await getProp(subAccountId, w.fundingFree, false, subAccountCluster), !i ? 1e8 : 0);
        strictEqual(await getProp(user, w.fundingFree), 1e8);
        strictEqual(await getProp(user, w.free), i ? 3e8 : 2e8);
        strictEqual(await redis[user[0]].llenAsync(user + w.balance), 2 + i);
        data = JSON.parse(await redis[user[0]].lindexAsync(user + w.balance, 0));
        strictEqual(data[1], "Transfer from sub account " + email + " wallet");
        strictEqual(data[2], 1e8);
        strictEqual(await redis[subAccountCluster].llenAsync(subAccountId + w.balance), 2 + i);
        await wait(100);
        data = await mongo[subAccountCluster].collection(w.balance + getCluster(subAccountId)).find({id: subAccountId}).toArray();
        strictEqual(data.length, 2 + i);
        data = JSON.parse(await redis[subAccountCluster].lindexAsync(subAccountId + w.balance, 0));
        strictEqual(data[1], "Transfer to parent account wallet");
        strictEqual(data[2], -1e8);
        data = await mongo[user[0]].collection(w.balance + getCluster(user)).find({id: user}).toArray();
        strictEqual(data.length, 2 + i);
        i++;
    }
    /*****Transfer from a sub account to the parent account*****/


    process.exit(0);
})();