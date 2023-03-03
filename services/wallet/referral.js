const redis = require('../../redis'),
    w = require('../../words'),
    router = require('../../router'),
    {publish} = require("../../utilities/commons"),
    {takeLockAsync} = require("../../utilities/lock");

router[w.referral + w.transfer] = async (id, c, json, callback) => {
    await takeLockAsync(c + id + w.referral + w.transfer);
    const result = Number(await redis[c][w.hgetAsync](id, w.referralFree));
    if (!result) throw w.IMPOSSIBLE_OPERATION;
    await redis[c][w.hincrbyAsync](id, w.referralFree, Math.round(result * -1));
    //TODO careful with address increase
    publish([id, c, null, result, [Date.now(), "Referral transfer", result], null], c, w.deposits);
    callback(false, w.TRANSFER_COMPLETED);
};