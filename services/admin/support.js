const w = require('../../words'),
    router = require('../../router'),
    mongo = require('../../mongo'),
    {getCluster} = require("../../utilities/commons"),
    {takeLockAsync} = require("../../utilities/lock");

router[w.noUserCheck][w.error] = true;

router['error'] = async (id, c, json, callback, args) => {
    const {ip} = args;
    const {error, stack} = json;
    if (!error || !stack) throw w.IMPOSSIBLE_OPERATION;
    await takeLockAsync(getCluster(ip) + ip);
    await mongo[getCluster(error)].collection(w.error).insertOne({error, stack, country: args.req.country});
    callback(false);
};