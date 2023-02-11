const equity = require('./equity'),
    redis = require('../../redis'),
    mongo = require('../../mongo'),
    w = require('../../words'),
    router = require('../../router'),
    {publish, getCluster} = require("../../utilities/commons"),
    {initAccount} = require("../account/initAccount"),
    {takeLockAsync} = require("../../utilities/lock");

router[w.transfer] = async (id, c, json, callback) => {

    await takeLockAsync(c + id + w.transfer);

    const result = await redis[c][w.hmgetAsync](id, w.free, w.fundingFree, w.subAccount, w.subAccount + w.cluster, w.email);
    result.forEach((n, i) => {
        if (i < 2) result[i] = Number(n)
    });
    let [free, fundingFree, otherAccount, otherAccountCluster, subAccountEmail] = result;

    const commands = [], qty = Math.round(json[w.quantity]);

    if (isNaN(qty) || qty <= 0 || !qty) throw w.MISSING_AMOUNT;

    let {from, to} = json;

    if (to && !otherAccount) { // case parent account send to sub account
        const subAccount = JSON.parse(await redis[c][w.hgetAsync](id + w.subAccount, to));
        if (!subAccount) throw w.UNKNOWN_ACCOUNT;
        otherAccount = subAccount[w.id];
        otherAccountCluster = getCluster(to);
    } else if (to && otherAccount) {
        if (to !== w.parentAccount) throw w.IMPOSSIBLE_OPERATION;
    }

    if (from === w.funding && fundingFree >= qty) {
        transferEquity(from, commands, id, qty);
        if (!to) {
            free += qty;
            commands.push([w.hgetall, id]);
            commands.push([w.lrange, id + w.borrowed, 0, -1]);
        }
        fundingFree -= qty;
    } else if (from === w.margin && free >= qty) {
        transferEquity(from, commands, id, qty);
        free -= qty;
        if (!to) fundingFree += qty;
    } else {
        throw w.IMPOSSIBLE_OPERATION;
    }

    if (to) {
        commands[0].length = 4;
        const msg = [
            Date.now(),
            "Transfer to " + (!subAccountEmail ? ("sub account " + to) : "parent account") + " wallet",
            qty * -1
        ];
        await save(id, c, commands, from, to, free, fundingFree, msg);
        msg[1] = "Transfer from " + (subAccountEmail ? ("sub account " + subAccountEmail) : "parent account") + " wallet";
        msg[2] *= -1;
        publish([otherAccount, otherAccountCluster, null, qty, msg, ""], otherAccountCluster, w.deposits);
    } else {
        await execute(id, c, commands, from, to, free, fundingFree);
    }

    callback(false, w.TRANSFER_COMPLETED);
};

async function save(id, c, commands, from, to, free, fundingFree, msg) {
    commands.push([w.lpush, id + w.balance, JSON.stringify(msg)]);
    await execute(id, c, commands, from, to, free, fundingFree);
    mongo[c].collection(w.balance + getCluster(id)).insertOne({
        id,
        [w.timestamp]: msg[0],
        [w.label]: msg[1],
        [w.quantity]: msg[2]
    });
    publish({
        [w.individuals]: [
            {id, [w.msg]: {[w.balance]: msg}},
            {id, [w.msg]: {free, fundingFree}}
        ]
    }, c);
}

async function execute(id, c, commands, from, to, free, fundingFree) {
    const replies = await redis[c].multi(commands).execAsync();
    if (from === w.funding && !to) addEquity(id, c, replies);
    else if (!to) publish({[w.individuals]: [{id, [w.msg]: {free, fundingFree}}]}, c);
}

function transferEquity(from, commands, id, qty) {
    if (from === w.funding) {
        commands.push([w.hincrby, id, w.fundingFree, Math.round(qty * -1), w.free, Math.round(qty)]);
    } else {
        commands.push([w.hincrby, id, w.free, Math.round(qty * -1), w.fundingFree, Math.round(qty)]);
    }
}

function addEquity(id, c, replies) {
    const account = replies[replies.length - 2];
    account[w.BTCList] = replies[replies.length - 1];
    initAccount(account, false, false, null, Date.now(), c);
    equity(id, c, account);
    const {free, locked, fundingFree, margin} = account;
    publish({[w.individuals]: [{id, [w.msg]: {free, locked, fundingFree, margin}}]}, c);
}