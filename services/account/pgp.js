const {ObjectId} = require('mongodb'),
    {readKey} = require('openpgp'),
    redis = require('../../redis'),
    mongo = require('../../mongo'),
    w = require('../../words'),
    router = require('../../router'),
    {takeLockAsync} = require("../../utilities/lock");

router[w.pgp] = async (id, c, json, callback) => {
    await takeLockAsync(c + id + w.pgp);
    const {t, key} = json;
    if (t === w.del) {
        await redis[c][w.hdelAsync](id + w.map, w.pgp);
        await updateKey(id, c, null);
    } else if (t === w.get) {
        const user = await mongo[c].collection(w.users).findOne({[w.mongoId]: ObjectId(id)});
        return callback(false, user[w.pgp]);
    } else if (t === w.set) {
        console.log(key);
        await readKey({armoredKey: key});
        await redis[c][w.hsetAsync](id + w.map, w.pgp, w.true);
        await updateKey(id, c, key);
    } else {
        throw w.IMPOSSIBLE_OPERATION;
    }
    callback(false);
};

async function updateKey(id, c, pgp) {
    await mongo[c].collection(w.users).updateOne({[w.mongoId]: ObjectId(id)}, {$set: {pgp}});
}

