const redis = require('../../redis'),
    router = require('../../router'),
    w = require('../../words'),
    crypto = require('crypto'),
    {takeLockAsync} = require('../../utilities/lock'),
    hash = require('../../utilities/hash'),
    {isBan, webEvent} = require("../../utilities/commons");

router[w.api] = async (id, c, json, callback) => {
    await takeLockAsync(c + id + w.api);
    let {key} = json;
    if (key) {
        const user = JSON.parse(await redis[c][w.getAsync](w.api + key));
        if (!user || user[w.id] !== id) throw w.UNAUTHORIZED_OPERATION;
        await redis[c][w.delAsync](w.api + key);
        await redis[c][w.hdelAsync](id + w.map, w.key, w.secret);
        webEvent({[w.key]: null, [w.secret]: null}, id, c);
        callback(false);
    } else {
        key = c + c + hash.genRandomString(62);
        const secret = hash.genRandomString(64);
        await redis[c][w.setAsync](w.api + key, JSON.stringify({id, c, ...hash.encrypt(secret, key, 'enc')}));
        await redis[c][w.hsetAsync](id + w.map, w.key, key, w.secret, secret.substring(0, 5));
        webEvent({key, secret}, id, c);
        callback(false, {key, secret});
    }
};

exports.verify = async (key, message, time, ip) => {
    try {
        await isBan(ip);
        const user = JSON.parse(await redis[key[0]].getAsync(w.api + key));
        if (!user) throw "bad key";
        user.secret = hash.decrypt(user['enc'], Buffer.from(key, 'hex'), user['enciv']);
        if (crypto.createHmac('sha512', user.secret).update(time).digest('hex') !== message) throw "bad secret";
        return {[w.api]: true, ...user};
    } catch (e) {
        return {};
    }
};