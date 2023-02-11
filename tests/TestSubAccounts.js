const {strictEqual} = require('assert');
const fs = require('fs');
const w = require('../words');
const {httpGet, query, clearLock, clearIPLock} = require("./utilities");
const redis = require('../redis');
const mongo = require('../mongo');
const {httpPost} = require("./utilities");
const {clearCache} = require("./clearCache");
const {getCluster} = require("../utilities/commons");

const email = Date.now() + "@mail.com", password = "rehhgzegerghez654ez4g";

async function del() {
    await clearIPLock();
}

let error, data, session, user, subUser, cluster, subCluster;

(async () => {

    await clearCache();

    ({error, data} = await httpGet('/signup' + query({})));
    await del();
    strictEqual(error, true);
    strictEqual(data, w.INVALID_EMAIL);

    ({error, data} = await httpGet('/signup' + query({email})));
    await del();
    strictEqual(error, true);
    strictEqual(data, w.UNSECURED_PASSWORD);

    ({error, data} = await httpGet('/signup' + query({email, password})));
    await del();
    strictEqual(error, false, data);
    const users = await mongo[getCluster(email)].collection(w.users).find({email}).toArray();
    strictEqual(users.length, 1);
    session = data;
    user = "" + users[0][w.mongoId];
    cluster = "" + users[0][w.cluster];

    ({error, data} = await httpGet('/sa', session));
    await clearLock(user + w.subAccount, cluster);
    strictEqual(error, false);
    strictEqual(data, null);

    ({error, data} = await httpGet('/signup' + query({email, password})));
    await del();
    strictEqual(error, true);
    strictEqual(data, w.EMAIL_TAKEN);

    ({error, data} = await httpGet('/signup' + query({email: email.toUpperCase(), password})));
    await del();
    strictEqual(error, true);
    strictEqual(data, w.EMAIL_TAKEN);

    ({error, data} = await httpGet('/signupsa' + query({email, password, subAccount: true})));
    await del();
    strictEqual(error, true);
    strictEqual(data, w.UNAUTHORIZED_OPERATION);

    ({error, data} = await httpGet('/signupsa' + query({email, password, subAccount: true}), session));
    await del();
    strictEqual(error, true);
    strictEqual(data, w.EMAIL_TAKEN);

    const nsa = Date.now() + "@mail.com", parentSession = session;

    ({error} = await httpPost('/signupsa', session, null, null, JSON.stringify({
        email: nsa,
        password,
        subAccount: true,
        [w.withdraw]: true
    })));
    await del();
    strictEqual(error, false);

    ({error, data} = await httpGet('/sa', session));
    strictEqual(error, false);
    data[nsa] = JSON.parse(data[nsa]);
    strictEqual(data[nsa].disabled, false);
    strictEqual(Array.isArray(data[nsa].right), true);
    strictEqual(data[nsa].right[0], true);
    strictEqual(data[nsa].right[1], false);

    ({error, data} = await httpGet('/signin' + query({email: nsa, password})));
    strictEqual(error, false);
    session = data;
    subUser = await mongo[session[0]].collection(w.users).findOne({email: nsa});
    subCluster = "" + subUser[w.cluster];
    subUser = "" + subUser[w.mongoId];
    await del();

    ({error, data} = await httpGet('/signupsa' + query({email: nsa, password, subAccount: true}), session));
    strictEqual(error, true);
    strictEqual(data, w.UNAUTHORIZED_OPERATION);
    await del();

    ({error, data} = await httpGet('/signup' + query({email: nsa, password, subAccount: true}), session));
    strictEqual(error, true);
    strictEqual(data, w.EMAIL_TAKEN);
    await del();

    ({error, data} = await httpGet('/ad', session));
    strictEqual(error, true);
    strictEqual(data, w.UNAUTHORIZED_OPERATION);
    await clearLock(subUser + w.address, subCluster);

    ({error, data} = await httpGet('/w', session));
    strictEqual(error, true);
    strictEqual(data, w.BAD_ADDRESS);
    await clearLock(subUser + w.withdraw, subCluster);

    ({error} = await httpPost('/usa', parentSession, null, null, JSON.stringify({email: nsa, [w.address]: true})));
    strictEqual(error, false);
    subUser = await mongo[getCluster(nsa)].collection(w.users).findOne({email: nsa});
    subCluster = "" + subUser[w.cluster];
    strictEqual(subUser[w.subAccount], "" + (await mongo[getCluster(email)].collection(w.users).findOne({email}))[w.mongoId]);
    strictEqual(subUser[w.disabled], false);
    subUser = "" + subUser[w.mongoId];
    const right = await redis[subCluster].hgetAsync(subUser, w.right);
    strictEqual(right, JSON.stringify([false, true]));

    data = await getSubAccounts(parentSession, nsa);
    strictEqual(data[nsa].disabled, false);
    strictEqual(Array.isArray(data[nsa].right), true);
    strictEqual(data[nsa].right[0], false);
    strictEqual(data[nsa].right[1], true);

    ({error} = await httpGet('/ad', session));
    strictEqual(error, false);
    await clearLock(subUser + w.address, subCluster);

    await redis[w.minus + session[0]][w.setAsync](w.withdraw + "token", session);
    ({error, data} = await httpGet('/w' + query({
        ad: "1JmYxUDk17M1zDd3QYDZPA1tErW3bgqV22",
        q: 1e8,
        token: "token"
    }), session));
    strictEqual(error, true);
    strictEqual(data, w.UNAUTHORIZED_OPERATION);

    ({error} = await httpPost('/upload?name=toast.jpg', session, false, null, fs.readFileSync(require('os').homedir() + "/document.pdf")));
    strictEqual(error, true, data);

    await clearLock(user + w.updateSubAccount, cluster);
    ({error} = await httpPost('/usa', parentSession, null, null, JSON.stringify({email: nsa, [w.disabled]: true})));
    strictEqual(error, false);

    data = await getSubAccounts(parentSession, nsa);
    strictEqual(data[nsa].disabled, true);
    strictEqual(Array.isArray(data[nsa].right), true);
    strictEqual(data[nsa].right[0], false);
    strictEqual(data[nsa].right[1], false);

    ({error, data} = await httpGet('/signin' + query({email: nsa, password})));
    strictEqual(error, true);
    strictEqual(data, w.DISABLED_SUBACCOUNT);

    process.exit(0);
})();

async function getSubAccounts(parentSession, nsa) {
    await clearLock(user + w.subAccount, cluster);
    ({error, data} = await httpGet('/sa', parentSession));
    strictEqual(error, false);
    data[nsa] = JSON.parse(data[nsa]);
    return data;
}