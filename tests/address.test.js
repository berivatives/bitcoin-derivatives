const {strictEqual} = require('assert');
const w = require('../words');
const {httpGet, query, createUser} = require("./utilities");
const redis = require("../redis");
const mongo = require("../mongo");
const {clearLock} = require("./utilities");
const {validate} = require('bitcoin-address-validation');
const {clearCache} = require("./clearCache");

let error, data, legacy, bech32;

(async () => {

    await clearCache();
    const [session, user] = await createUser();
    ({error, data} = await httpGet('/ad', session));
    await clearLock(user + w.address, user[0]);
    strictEqual(error, false, data);
    strictEqual(validate(data), true);
    legacy = data;

    data = await redis[user[0]].hgetallAsync(user + w.map);
    strictEqual(data[w.legacy], legacy);
    strictEqual(data[w.addressUsed + w.legacy], '0');
    strictEqual((await mongo[user[0]].collection(w.addresses).find({ad: legacy}).toArray()).length, 1);

    ({error, data} = await httpGet('/' + w.sign + query({[w.label]: "toast"}), session));
    strictEqual(error, false);
    strictEqual(data.length, 88);

    ({error, data} = await httpGet('/ad' + query({[w.addressType]: w.bech32}), session));
    await clearLock(user + w.address, user[0]);
    strictEqual(error, false, data);
    strictEqual(validate(data), true);

    bech32 = data;

    strictEqual((await mongo[user[0]].collection(w.addresses).find({ad: bech32}).toArray()).length, 1);

    data = await redis[user[0]].hgetallAsync(user + w.map);
    strictEqual(data[w.legacy], legacy);
    strictEqual(data[w.addressUsed + w.legacy], '0');
    strictEqual(data[w.bech32], bech32);
    strictEqual(data[w.addressUsed + w.bech32], '0');

    ({error, data} = await httpGet('/ad' + query({[w.addressType]: w.bech32}), session));
    await clearLock(user + w.address, user[0]);
    strictEqual(error, true);
    strictEqual(data, w.USED_ADDRESS_AT_LEAST_ONCE);

    process.exit(0);
})();