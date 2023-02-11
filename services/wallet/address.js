const w = require('../../words'),
    redis = require('../../redis'),
    mongo = require('../../mongo'),
    router = require('../../router'),
    {publish} = require('../../utilities/commons'),
    bitcoinRPC = require('../../utilities/bitcoinRPC'),
    {takeLockAsync} = require("../../utilities/lock");

router[w.address] = async (id, c, json, callback) => {
    await takeLockAsync(c + id + w.address);

    const addressType = json[w.addressType] === w.bech32 ? w.bech32 : w.legacy;

    const depositCounter = await redis[c][w.hgetAsync](id + w.map, w.addressUsed + addressType);
    const [subAccount, right] = await redis[c][w.hmgetAsync](id, w.subAccount, w.right);

    if (depositCounter === "0") throw w.USED_ADDRESS_AT_LEAST_ONCE;
    if (subAccount && (!right || !JSON.parse(right)[1])) throw w.UNAUTHORIZED_OPERATION;

    const {result, code} = await bitcoinRPC('getnewaddress', ['""', addressType]);
    if (code) throw w.UNKNOWN_ERROR;

    const ad = result;

    await mongo[c].collection(w.addresses).insertOne({id, ad, c});
    await redis[c][w.hsetAsync](id + w.map, addressType, ad, w.addressUsed + addressType, 0);

    publish({[w.individuals]: [{id, [w.msg]: {[addressType]: ad}}]}, c);
    publish({id, ad, c}, c, w.addresses);

    callback(false, ad);
};