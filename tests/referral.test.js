const {strictEqual} = require('assert');
const {ObjectId} = require('mongodb');
const w = require('../words');
const {wait} = require("../utilities/commons");
const {clearCache} = require("./clearCache");
const redis = require("../redis");
const mongo = require("../mongo");
const {clearIPLock} = require("./utilities");
const {checkBalance} = require("./utilities");
const {osCommand, publish, getCluster} = require("../utilities/commons");
const {httpGet, query, createUser, getProp, order} = require("./utilities");

let error, data, session, user, session2, user2, cluster;

(async () => {

    await clearCache();


    /*******Test referral signup********/
    const email = Date.now() + "@mail.com", password = "rgezfgnbezgloergezer98479za4é";
    ({error} = await httpGet('/signup' + query({email, password})));
    strictEqual(error, false);
    cluster = getCluster(email);
    await osCommand("node", ["../scripts/referral", email]);
    const value = await mongo[cluster].collection(w.users).findOne({email});
    strictEqual(value[w.referral], true);
    await clearIPLock();
    ({error, data} = await httpGet('/signup' + query({
        email: Date.now() + "@mail.com",
        password,
        referral: ObjectId() + "_0"
    })));
    strictEqual(error, true);
    strictEqual(data, w.UNAUTHORIZED_OPERATION);
    await clearIPLock();
    const email2 = Date.now() + "@mail.com";
    ({error, data} = await httpGet('/signup' + query({
        email: email2,
        password,
        referral: value[w.mongoId] + "_" + cluster
    })));
    strictEqual(error, false);
    cluster = getCluster(email2);
    strictEqual(await getProp(await redis[w.minus + cluster].getAsync("session" + data), w.referral, true, cluster), value[w.mongoId] + "_" + getCluster(email));
    /*******Test referral signup********/


    /*******Test referral fees calculation in the matching engine********/
    const makerFee = -0.01 / 100, takerFee = 0.05 / 100;
    publish({[w.fee]: [makerFee, takerFee]}, 0);
    [session, user, cluster] = await createUser([w.free, 2e8]);
    await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session);
    [session2, user2] = await createUser([w.free, 2e8, w.referral, user + "_" + cluster]);
    await order({q: 1e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session2);
    const referralFee = 1e8 * (makerFee + takerFee) / 2;
    await checkBalance(user, w.free, 1e8 - makerFee * 1e8, w.locked, 1e8, w.fundingFree, 0, w.referralFree, referralFee);
    await checkBalance(user2, w.free, 1e8 - takerFee * 1e8, w.locked, 1e8, w.fundingFree, 0, w.referralFree, 0);
    /*******Test referral fees calculation in the matching engine********/


    /*******Transfer referral fees********/
    ({error, data} = await httpGet('/' + w.referral + w.transfer, session2));
    strictEqual(error, true);
    strictEqual(data, w.IMPOSSIBLE_OPERATION);

    ({error, data} = await httpGet('/' + w.referral + w.transfer, session));
    strictEqual(error, false);
    strictEqual(data, w.TRANSFER_COMPLETED);
    await wait(1000);
    await checkBalance(user, w.free, 1e8 - makerFee * 1e8 + referralFee, w.locked, 1e8, w.fundingFree, 0, w.referralFree, 0);
    data = await mongo[cluster].collection(w.balance + getCluster(user)).find({id: user}).toArray();
    strictEqual(data.length, 1);
    strictEqual(data[0][w.label], "Referral transfer");
    strictEqual(data[0][w.quantity], referralFee);
    strictEqual(await redis[cluster][w.llenAsync](user + w.balance), 1);
    /*******Transfer referral fees********/


    process.exit(0);
})();