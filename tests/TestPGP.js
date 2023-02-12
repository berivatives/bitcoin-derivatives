const {strictEqual} = require('assert');
const {ObjectId} = require('mongodb');
const w = require('../words');
const redis = require("../redis");
const mongo = require("../mongo");
const openpgp = require('openpgp');
const {clearLock, httpGet, query} = require("./utilities");
const {getCluster} = require("../utilities/commons");

let error, data;

(async () => {
    const email = Date.now() + "@mail.com";
    ({data, error} = await httpGet('/signup' + query({email, password: Date.now()})));
    strictEqual(error, false);

    const session = data;
    const id = await redis["-" + 0][w.getAsync]("session" + session);
    const c = getCluster(email);

    ({error, data} = await httpGet('/pgp', session));
    strictEqual(error, true);
    strictEqual(data, w.IMPOSSIBLE_OPERATION);
    await clearLock(id + w.pgp, c);

    let key = "key";

    ({error, data} = await httpGet('/pgp' + query({t: 'set', key}), session));
    strictEqual(error, true);
    strictEqual(data, w.UNKNOWN_ERROR);
    await exists(id, c, null);
    await clearLock(id + w.pgp, c);

    const {publicKey} = await openpgp.generateKey({
        curve: 'curve25519',
        userIDs: [{name: 'Test', email: 'test@test.com'}]
    });
    key = publicKey;

    ({error, data} = await httpGet('/pgp' + query({t: 'set', key}), session));
    strictEqual(error, false, data);
    await exists(id, c, w.true);
    await clearLock(id + w.pgp, c);
    strictEqual((await mongo[c].collection(w.users).findOne({_id: ObjectId(id)})).pgp, key);

    ({error, data} = await httpGet('/pgp' + query({t: 'get'}), session));
    strictEqual(error, false);
    strictEqual(data, key);
    await clearLock(id + w.pgp, c);

    ({error} = await httpGet('/pgp' + query({t: 'del'}), session));
    strictEqual(error, false);
    await exists(id, c, null);
    strictEqual((await mongo[c].collection(w.users).findOne({_id: ObjectId(id)})).pgp, null);
    process.exit(0);
})();

async function exists(id, c, expected) {
    strictEqual(await redis[c][w.hgetAsync](id + w.map, w.pgp), expected);
}