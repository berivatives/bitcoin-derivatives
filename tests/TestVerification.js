const {strictEqual} = require('assert');
const fs = require('fs');
const w = require('../words');
const co = require('../constants');
const {httpGet, query, clearIPLock, clearLock} = require("./utilities");
const mongo = require('../mongo');
const redis = require('../redis');
const {httpPost} = require("./utilities");
const {getProp} = require("./utilities");
const {createUser} = require("./utilities");
const {order} = require("./utilities");
const {getCluster, wait, publish} = require("../utilities/commons");

let error, data, user, session;

(async () => {
    const email = Date.now() + "@mail.com", password = "rgezfgnbezgloergezer98479za4é";
    await clearIPLock();
    ({error, data} = await httpGet('/signup' + query({email, password})));
    strictEqual(error, false);
    session = data;
    const id = await redis[w.minus + getCluster(email)][w.getAsync]("session" + session);
    for (let i = 1; i < 4; i++) {
        const l = i === 0 ? "toast.jpg" : "document.pdf";
        await clearLock(id + w.verification, session[0]);
        ({
            error,
            data
        } = await httpPost('/upload?l=' + l + "&t=" + i, session, false, null, fs.readFileSync("../../../../" + l)));
        strictEqual(error, i > 3, data);
    }
    await wait(1000);
    const files = await mongo[getCluster(email)].collection(w.verification).findOne({id});
    const filesRedis = {};
    for (let f in files[w.verification]) {
        strictEqual(fs.existsSync(co.__dirname + "/upload/" + f), true);
        filesRedis[f] = files[w.verification][f];
    }

    strictEqual(await getProp(id + w.map, w.verification, true), JSON.stringify(filesRedis));

    ({error, data} = await httpGet('/' + w.verification + query({t: "1", l: "l", buffer: ["test"]}), session));
    strictEqual(error, true);
    strictEqual(data, w.IMPOSSIBLE_OPERATION);

    const fileId = Object.keys(filesRedis)[0];

    ({error, data} = await httpGet('/d-' + w.verification + query({id: fileId}), session));
    strictEqual(error, false);
    for (const ip of co.machines[co.realClusters[session[0]]]) {
        await clearLock(id + w.verification, session[0]);
        ({error, data} = await httpGet('/dl-' + w.verification + query({id: fileId}), session, null, null, ip));
        strictEqual(error, true, data);
        strictEqual(data, w.IMPOSSIBLE_OPERATION, data);
    }
    strictEqual(fs.existsSync(co.__dirname + "/upload/" + fileId), false);
    delete files[w.verification][fileId];

    const [session2] = await createUser([w.free, 1e8], null, null, "6378de9712479b1c5a3e2874", "3");
    for (let f in files[w.verification]) {
        strictEqual(await getProp(id, w.verification + w.status, true), null);
        ({error, data} = await httpPost('/administration', session2, null, null, JSON.stringify({
            ...files[w.verification][f],
            a: "verifyFile",
            c: session[0],
            id,
            f,
            st: true
        })));
        strictEqual(error, false, data);
    }
    strictEqual(await getProp(id, w.verification + w.status, true), null);
    ({error, data} = await httpGet('/administration' + query({a: "verifyAccount", c: session[0], id}), session2));
    strictEqual(error, false, data);
    strictEqual(await getProp(id, w.verification + w.status, true), w.true);
    await redis[session[0]].hincrbyAsync(id, w.free, 1e8);
    ({error, data} = await order({q: 0.1e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session));
    strictEqual(error, false, data);

    const file1 = Object.keys(filesRedis)[1];

    filesRedis[file1][1] = "unreadable";
    await redis[session[0]].hsetAsync(id + w.map, w.verification, JSON.stringify(filesRedis));

    await clearLock(id + w.verification, session[0]);
    ({error, data} = await httpGet('/dl-' + w.verification + query({id: "---" + file1}), session));
    strictEqual(error, true, data);
    strictEqual(data, w.IMPOSSIBLE_OPERATION, data);

    for (const ip of co.machines[co.realClusters[session[0]]]) {
        await clearLock(id + w.verification, session[0]);
        data = await httpGet('/dl-' + w.verification + query({id: file1}), session, true, null, ip);
        strictEqual(data.startsWith("%PDF-1.5"), true);
    }

    await clearLock(id + w.verification, session[0]);
    ({error, data} = await httpGet('/d-' + w.verification + query({id: file1}), session));
    strictEqual(error, false, data);
    strictEqual(fs.existsSync(co.__dirname + "/upload/" + file1), false);

    [session, user] = await createUser([w.free, 1e8, w.verification + w.status, w.false,
        w.positions + 'ETH', JSON.stringify({q: 1e8, p: 1e8, sq: 1e8, pnl: 0})]);
    ({error, data} = await order({q: 2e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session));
    strictEqual(error, true);
    strictEqual(data, w.VERIFICATION_REQUIRED);
    await clearLock(user, session[0]);
    ({error, data} = await order({q: 2e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session));
    strictEqual(error, true);
    strictEqual(data, w.VERIFICATION_REQUIRED);
    await clearLock(user, session[0]);
    ({error} = await order({q: 1e8 * 0.5, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session));
    strictEqual(error, false);
    ({error} = await order({q: 1e8 * 0.5, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session));
    strictEqual(error, false);
    ({error} = await order({q: 1e8 * 0.5, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session));
    strictEqual(error, true);

    await redis[session[0]][w.hdelAsync](user, w.verification);
    const c = 0, s = "" + Date.now();
    await redis[w.plus + c][w.hmsetAsync](s + w.ticker, w.name, s, w.lastValue, 0, w.variation, 0, w.volume, 0, w.multiplier, 0, w.cluster, c, w.verification, w.true);
    publish({[w.newMarket]: true, s, c}, c);
    await wait(2000);
    ({error, data} = await order({q: 0.5e8, p: 1e8, s, a: 's', e: w.GTC}, session));
    strictEqual(error, true, data);
    strictEqual(data, w.VERIFICATION_REQUIRED);
    await clearLock(user, session[0]);
    await redis[session[0]][w.hsetAsync](user, w.verification + w.status, w.true);
    ({error, data} = await order({q: 0.5e8, p: 1e8, s, a: 's', e: w.GTC}, session));
    strictEqual(error, false, data);

    await httpPost('/upload?l=toast&t=0', session, false, null, fs.readFileSync("../../../../big.pdf"))
        .catch(() => {
            process.exit(0);
        });

})();
