const speakeasy = require('speakeasy'),
    {ObjectId} = require('mongodb'),
    w = require('../../words'),
    mongo = require('../../mongo'),
    redis = require('../../redis'),
    router = require('../../router'),
    {takeLockAsync} = require('../../utilities/lock'),
    {decrypt, genRandomString, encrypt} = require("../../utilities/hash"),
    {webEvent} = require("../../utilities/commons");

router[w.tfa] = async (id, c, json, callback) => {
    await takeLockAsync(c + id);
    const secret = speakeasy.generateSecret({length: 10});
    await redis[w.minus + c][w.setAsync](id + w.tfa, secret.base32, 'EX', 60 * 15);
    callback(false, secret.otpauth_url.replace("SecretKey", w.authName));
};

router['c-' + w.tfa] = async (id, c, json, callback) => {
    const secret = await redis[w.minus + c][w.getAsync](id + w.tfa);
    if (!secret) throw w.UNKNOWN_ERROR;
    verifyToken(secret, String(json['token']));
    const key = genRandomString(64);
    await mongo[c].collection(w.users).updateOne({[w.mongoId]: ObjectId(id)}, {
        $set: {key, ...encrypt(secret, key, w.tfa)}
    });
    await redis[w.minus + c][w.delAsync](id + w.tfa);
    await redis[c][w.hsetAsync](id + w.map, w.tfa, w.true);
    callback(false);
    webEvent({[w.tfa]: true}, id, c);
};

router['d-' + w.tfa] = async (id, c, json, callback) => {
    await takeLockAsync(c + id);
    const user = await mongo[c].collection(w.users).findOne({[w.mongoId]: ObjectId(id)});
    if (!user) throw w.UNKNOWN_ERROR;
    const secret = decrypt(user[w.tfa], Buffer.from(user[w.key], 'hex'), user[w.tfa + 'iv']);
    verifyToken(secret, String(json['token']));
    await mongo[c].collection(w.users).updateOne({[w.mongoId]: ObjectId(id)}, {$set: {[w.key]: null}});
    await redis[c][w.hdelAsync](id + w.map, w.tfa);
    callback(false);
    webEvent({[w.tfa]: null}, id, c);
};

function verifyToken(secret, token) {
    if (!speakeasy.totp['verifyDelta']({
        secret,
        encoding: 'base32',
        token,
        window: 2
    })) throw w.BAD_TOKEN;
}