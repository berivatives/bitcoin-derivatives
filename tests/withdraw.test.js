const {strictEqual} = require('assert');
const w = require('../words');
const {httpGet, query, createUser} = require("./utilities");
const mongo = require("../mongo");
const redis = require("../redis");
const {checkBalance} = require("./utilities");
const {clearLock} = require("./utilities");
const {clearCache} = require("./clearCache");
const {wait, getCluster} = require("../utilities/commons");
const ad = "1JmYxUDk17M1zDd3QYDZPA1tErW3bgqV22";

let error, data;

(async () => {

    await clearCache();
    let [session, user] = await createUser([w.verification + w.status, w.true]);

    ({error, data} = await httpGet('/w', session));
    strictEqual(error, true);
    strictEqual(data, w.BAD_ADDRESS);
    await clearLock(user + w.withdraw, user[0]);

    ({error, data} = await withdraw({ad: "1JmYxUDk17M1zDd3QYDZPA1tErW3bgqV2"}, session));
    strictEqual(error, true);
    strictEqual(data, w.BAD_ADDRESS);
    await clearLock(user + w.withdraw, user[0]);

    ({error, data} = await withdraw({ad: "1JmYxUDk17M1zDd3QYDZPA1tErW3bgqV2", q: 1e8}, session));
    strictEqual(error, true);
    strictEqual(data, w.BAD_ADDRESS);
    await clearLock(user + w.withdraw, user[0]);

    ({error, data} = await withdraw({ad}, session));
    strictEqual(error, true);
    strictEqual(data, w.MISSING_AMOUNT);
    await clearLock(user + w.withdraw, user[0]);

    ({error, data} = await withdraw({ad, q: 1}, session));
    strictEqual(error, true);
    strictEqual(data, w.MINIMAL_AMOUNT);
    await clearLock(user + w.withdraw, user[0]);

    const token = "token";
    ({error, data} = await withdraw({ad, q: 1e8}, session, token));
    strictEqual(error, true);
    strictEqual(data, w.BAD_TOKEN);
    await clearLock(user + w.withdraw, user[0]);

    ({error, data} = await withdraw({ad, q: 1e8}, session));
    strictEqual(error, true);
    strictEqual(data, w.INSUFFICIENT_BALANCE);
    await clearLock(user + w.withdraw, user[0]);

    await redis[user[0]].hmsetAsync(user, w.free, 1e8 / 2, w.fundingFree, 1e8 / 2);
    ({error, data} = await withdraw({ad, q: 1e8}, session));
    strictEqual(error, true);
    strictEqual(data, w.HOT_WALLET_EMPTY_PLEASE_CONTACT_THE_SUPPORT);
    await clearLock(user + w.withdraw, user[0]);

    await checkBalance(user, w.free, 0, w.fundingFree, 0);

    await redis[user[0]].hmsetAsync(user, w.free, 1e8 / 2, w.fundingFree, 1e8);
    ({error, data} = await withdraw({ad, q: 1e8 / 2}, session));
    strictEqual(error, true);
    strictEqual(data, w.HOT_WALLET_EMPTY_PLEASE_CONTACT_THE_SUPPORT);

    await checkBalance(user, w.free, 1e8 / 2, w.fundingFree, 1e8 / 2);

    await wait(500);

    strictEqual(await logs(w.balance + getCluster(user), user), 2);
    strictEqual(await logs(w.withdrawLogs, user, -6), 2);

    ({error, data} = await withdraw({ad, q: 1e8 / 2}, session));
    strictEqual(error, true);
    strictEqual(data, w.PLEASE_DO_NOT_HURT_ME);

    [session, user] = await createUser([w.free, 2e8]);
    await withdraw({ad, q: 1e8}, session);
    await checkBalance(user, w.free, 1e8, w.counter + w.withdraw, 1e8);
    await clearLock(user + w.withdraw, user[0]);
    ({error, data} = await withdraw({ad, q: 1e8}, session));
    strictEqual(error, true);
    strictEqual(data, w.VERIFICATION_REQUIRED);
    await checkBalance(user, w.free, 1e8, w.counter + w.withdraw, 1e8);

    const [subAccountSession, subAccount] = await createUser([w.free, 2e8, w.subAccount, user, w.subAccount + w.cluster, user[0], w.right, JSON.stringify([true, true])]);
    ({error, data} = await withdraw({ad, q: 1e8}, subAccountSession));
    strictEqual(error, true);
    strictEqual(data, w.VERIFICATION_REQUIRED);
    await checkBalance(subAccount, w.free, 2e8, w.counter + w.withdraw, 0);
    await redis[user[0]][w.hsetAsync](user, w.counter + w.withdraw, 0.25e8);
    await clearLock(subAccount + w.withdraw, subAccount[0]);
    await withdraw({ad, q: 0.5e8}, subAccountSession);
    await checkBalance(subAccount, w.free, 1.5e8, w.counter + w.withdraw, 0);
    await checkBalance(user, w.free, 1e8, w.counter + w.withdraw, 0.75e8);

    // noinspection InfiniteLoopJS
    while (true) {
        const [session2, user2] = await createUser([w.free, 1e8 / 2, w.fundingFree, 1e8 / 2]);
        withdraw({ad, q: 1e8}, session2).then(async ({error}) => {
            try {
                if (error) {
                    strictEqual(await logs(w.withdrawLogs, user2, -1), 1);
                    await checkBalance(user2, w.free, -1e8 / 2, w.fundingFree, -1e8 / 2);
                    process.exit(0);
                }
            } catch (e) {

            }
        });
        await wait(1);
        await redis[user2[0]].hincrbyAsync(user2, w.free, -1e8 / 2, w.fundingFree, -1e8 / 2);
    }

})();

async function withdraw(body, session, t) {
    const token = t || ("" + Date.now());
    if (!t) await redis[w.minus + session[0]][w.setAsync](w.withdraw + token, session);
    return httpGet('/w' + query({...body, token}), session);
}

async function logs(collection, id, code) {
    return (await mongo[id[0]].collection(collection).find(code ? {id, code} : {id}).toArray()).length;
}