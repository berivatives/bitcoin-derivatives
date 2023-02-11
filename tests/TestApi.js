const {strictEqual} = require('assert');
const w = require('../words');
const {httpGet, getProp, query, createUser, clearLock} = require("./utilities");
const redis = require('../redis');
const {clearCache} = require("./clearCache");

let error, data;

(async () => {

    await clearCache();

    const [session, user] = await createUser([w.free, 1e8]);
    ({error, data} = await httpGet('/api', session));
    const {key, secret} = data;
    strictEqual(error, false);
    strictEqual(await getProp(user + w.map, w.key, true), key);
    strictEqual(await redis[user[0]]['existsAsync'](w.api + key), 1);
    strictEqual(await redis[user[0]]['existsAsync'](w.api + secret), 0);

    ({error, data} = await httpGet('/api' + query({key}), await createUser()));
    strictEqual(error, true);
    strictEqual(data, w.UNAUTHORIZED_OPERATION);

    ({error, data} = await httpGet('/t' + query({key, secret: secret + "bad", q: 1e8, from: w.margin}, true)));
    strictEqual(error, true);
    strictEqual(data, w.UNAUTHORIZED_OPERATION);

    ({error, data} = await httpGet('/t' + query({key, secret, q: 1e8, from: w.margin}, true)));
    strictEqual(data, w.TRANSFER_COMPLETED);
    strictEqual(error, false);

    await clearLock(user + w.api, user[0]);
    ({error, data} = await httpGet('/api' + query({key}), session));
    strictEqual(error, false);
    strictEqual(await getProp(user + w.map, w.key, true), null);

    process.exit(0);
})();

