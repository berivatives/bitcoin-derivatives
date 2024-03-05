const {strictEqual} = require('assert');
const w = require('../words');
const {httpGet, query, clearLock, clearIPLock} = require("./utilities");
const redis = require('../redis');
const {getCluster} = require("../utilities/commons");
const {clearCache} = require("./clearCache");

let error, data;

(async () => {

    await clearCache();
    const email = Date.now() + "@mail.com", password = "rgezfgnbezgloergezer98479za4é";
    ({error, data} = await httpGet('/signup' + query({email, password: email})));
    strictEqual(error, true);
    strictEqual(data, w.ARE_U_SERIOUS);

    await clearIPLock();
    ({error} = await httpGet('/signup' + query({email, password})));
    strictEqual(error, false);

    await clearIPLock();
    ({error, data} = await httpGet('/signin' + query({email, password: "bad"})));
    strictEqual(error, true);
    strictEqual(data, w.INVALID_PASSWORD);

    await clearIPLock();
    ({error, data} = await httpGet('/signin' + query({email, password})));
    strictEqual(error, false);

    const session = data;
    ({error, data} = await httpGet('/' + w.password + query({password: "new"}), session));
    strictEqual(error, true);
    strictEqual(data, w.UNSECURED_PASSWORD);

    const user = await redis[w.minus + getCluster(email)][w.getAsync]("session" + session);
    await clearLock(user + w.password, session[0]);
    const newPassword = "nzozn fg4ezf9ze74er4er5't";
    ({error, data} = await httpGet('/' + w.password + query({former: "bad former", password: newPassword}), session));
    strictEqual(error, true);
    strictEqual(data, w.INVALID_PASSWORD);

    await clearLock(user + w.password, session[0]);
    ({error, data} = await httpGet('/' + w.password + query({former: password, password: newPassword}), session));
    strictEqual(error, false);
    strictEqual(data, w.PASSWORD_UPDATED);

    await clearIPLock();
    ({error, data} = await httpGet('/signin' + query({email, password})));
    strictEqual(error, true);
    strictEqual(data, w.INVALID_PASSWORD);

    await clearIPLock();
    ({error} = await httpGet('/signin' + query({email, password: newPassword})));
    strictEqual(error, false);

    process.exit(0);
})();

