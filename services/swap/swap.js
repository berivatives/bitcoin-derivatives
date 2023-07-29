const {validate} = require('bitcoin-address-validation'),
    w = require('../../words'),
    co = require('../../constants'),
    redis = require('../../redis'),
    mongo = require('../../mongo'),
    router = require('../../router'),
    {getCluster} = require('../../utilities/commons'),
    bitcoinRPC = require('../../utilities/bitcoinRPC'),
    {takeLockAsync} = require("../../utilities/lock");

router[w.noUserCheck][w.swap] = true;

router[w.swap] = async (id, c, json, callback, args) => {
    const {ip} = args;
    await takeLockAsync(getCluster(ip) + ip);
    const {ad, from, to} = json, qty = Math.round(Number("" + json[w.quantity]));
    if (isNaN(qty) || !qty) throw w.MISSING_AMOUNT;
    if (qty < co.minimalWithdrawSAT) throw w.MINIMAL_AMOUNT;
    if (from === w.XMR && to === w.BTC) {
        if (!validate(ad)) throw w.BAD_ADDRESS;
        //TODO generate an xmr address
        callback(false, ad);
    } else if (from === w.BTC && to === w.XMR) {
        //TODO validate the xmr address
        const addressType = json[w.addressType] === w.bech32 ? w.bech32 : w.legacy;
        const {result, code} = await bitcoinRPC('getnewaddress', ['""', addressType]);
        if (code) throw w.UNKNOWN_ERROR;
        callback(false, result);
    } else {
        throw w.IMPOSSIBLE_OPERATION;
    }
};