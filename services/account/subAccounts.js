const redis = require('../../redis'),
    mongo = require('../../mongo'),
    co = require('../../constants'),
    w = require('../../words'),
    router = require('../../router'),
    {takeLockAsync} = require("../../utilities/lock"),
    {getCluster, getRights, webEvent} = require("../../utilities/commons"),
    {genRandomString} = require("../../utilities/hash");

router[w.subAccount] = async (id, c, json, callback) => {
    await takeLockAsync(c + id + w.subAccount);
    callback(false, await redis[c][w.hgetallAsync](id + w.subAccount));
};

router[w.updateSubAccount] = async (id, c, json, callback) => {
    await takeLockAsync(c + id + w.updateSubAccount);
    const subAccount = JSON.parse(await redis[c][w.hgetAsync](id + w.subAccount, json[w.email]));
    if (!subAccount) throw w.UNKNOWN_ACCOUNT;

    subAccount[w.disabled] = json[w.disabled] === true;
    subAccount[w.right] = getRights(json);

    const sac = getCluster(json[w.email]);

    await mongo[sac].collection(w.users).updateOne({[w.email]: json[w.email]}, {$set: {[w.disabled]: subAccount[w.disabled]}});
    await redis[sac][w.hsetAsync](subAccount[w.id], w.right, JSON.stringify(subAccount[w.right]));

    await redis[c][w.hsetAsync](id + w.subAccount, json[w.email], JSON.stringify(subAccount));

    subAccount[w.email] = json[w.email];
    webEvent({[w.subAccount]: subAccount}, id, c);

    callback(false);
};

router[w.connectSubAccount] = async (id, c, json, callback, args) => {
    await takeLockAsync(c + id + w.updateSubAccount);
    const subAccount = JSON.parse(await redis[c][w.hgetAsync](id + w.subAccount, json[w.email]));
    if (!subAccount) throw w.UNKNOWN_ACCOUNT;
    if (subAccount[w.disabled]) throw w.DISABLED_SUBACCOUNT;
    c = getCluster(json[w.email]);
    const session = c + genRandomString(128);
    await redis[w.minus + c].setAsync("session" + session, subAccount[w.id], 'NX', 'EX', 60 * 60 * 12);
    args.res[w.headerWritten] = {
        "Refresh": "0; url=" + (!co.isDev ? "/" : "http://localhost:3000") + "?email=" + json[w.email] + "&session=" + session
    };
    callback(false);
};