const {strictEqual} = require('assert');
const {ObjectId} = require('mongodb');
const w = require('../words');
const redis = require("../redis");
const mongo = require("../mongo");
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

    let key = Array(15000).fill("").toString();

    ({error, data} = await httpGet('/pgp' + query({t: 'set', key}), session));
    strictEqual(error, true);
    strictEqual(data, w.IMPOSSIBLE_OPERATION);
    await exists(id, c, null);
    await clearLock(id + w.pgp, c);

    key = "-----BEGIN PGP PUBLIC KEY BLOCK-----\n" +
        "\n" +
        "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\n" +
        "Hu4=\n" +
        "=6RzP\n" +
        "-----END PGP PUBLIC KEY BLOCK-----";

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