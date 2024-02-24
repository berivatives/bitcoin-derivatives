const {validate} = require('bitcoin-address-validation'),
    {strictEqual} = require('assert'),
    {ObjectId} = require('mongodb'),
    redis = require('../../redis'),
    mongo = require('../../mongo'),
    router = require('../../router'),
    co = require('../../constants'),
    w = require('../../words'),
    {roundTo, publish, getCluster} = require("../../utilities/commons"),
    {genRandomString} = require("../../utilities/hash"),
    bitcoinRPC = require('../../utilities/bitcoinRPC'),
    {takeLockAsync} = require("../../utilities/lock");

router[w.withdraw] = async (id, c, json, callback, {ip}) => {
    await takeLockAsync(c + id + w.withdraw);

    const {ad, l, token} = json, t = Date.now(), qty = Math.round(Number("" + json[w.quantity]));

    if (!validate(ad)) throw w.BAD_ADDRESS;

    if (isNaN(qty) || !qty) throw w.MISSING_AMOUNT;

    if (qty < co.minimalWithdrawSAT) throw w.MINIMAL_AMOUNT;

    if (!token || !await redis[w.minus + c][w.delAsync](w.withdraw + token.replace(/ /g, ''))) throw w.BAD_TOKEN;

    const balance = await redis[c][w.hmgetAsync](id, w.free, w.fundingFree, w.counter + w.withdraw, w.verification + w.status, w.subAccount, w.subAccount + w.cluster, w.right);

    const [, , , verification, mainAccount, mainAccountCluster, rights] = balance;

    let mainAccountCounter = 0;

    if (mainAccount) {
        if (!rights || !JSON.parse(rights)[0]) throw w.UNAUTHORIZED_OPERATION;
        mainAccountCounter = Number(await redis[mainAccountCluster][w.hgetAsync](mainAccount, w.counter + w.withdraw));
    }

    balance.length = 3;
    balance.forEach((n, i) => balance[i] = Number(n));
    let [free, fundingFree, counter] = balance;

    if (verification !== w.true && ((counter + mainAccountCounter + qty) > co.maxDailyWithdraw)) throw w.VERIFICATION_REQUIRED;

    if (free + fundingFree - qty < 0) throw w.INSUFFICIENT_BALANCE;

    const commands = [];
    let amount = qty, fromFunding, fromMargin;
    if (fundingFree > 0) {
        fromFunding = true;
        if (amount > fundingFree) {
            commands.push([w.hincrby, id, w.fundingFree, Math.round(fundingFree * -1)]);
            amount -= fundingFree;
            fundingFree = 0;
        } else {
            commands.push([w.hincrby, id, w.fundingFree, Math.round(amount * -1)]);
            fundingFree -= amount;
            amount = 0;
        }
    }
    if (amount > 0) {
        fromMargin = true;
        commands.push([w.hincrby, id, w.free, Math.round(amount * -1)]);
        free -= amount;
    }
    if (verification !== w.true) commands.push([w.hincrby, mainAccount || id, w.counter + w.withdraw, qty]);
    commands.push([w.hmget, id, w.free, w.fundingFree, w.counter + w.withdraw]);

    const res = await redis[c].multi(commands)[w.execAsync]();
    const newBalance = res[res.length - 1];
    newBalance.forEach((n, i) => newBalance[i] = Number(n));
    const [newFree, newFundingFree, newCounter] = newBalance;

    let code, result, txId;

    if (fromFunding && newFundingFree < 0 || fromMargin && newFree < 0) {
        code = -1;
    } else {
        const amountRounded = roundTo(qty / co.satoshi, 8);
        const decimals = String(amountRounded).split('.');
        if (decimals.length === 2) strictEqual(decimals[1].length <= 8, true);
        ({code, result} = await bitcoinRPC('sendtoaddress', [ad, amountRounded, l ? String(l) : '""', id, true]));
        txId = result;
    }

    const balanceMessage = [t, "Bitcoin withdraw to " + ad + (code !== 0 ? ' has failed' : ''), qty * -1];

    if (txId) balanceMessage.push(txId);

    const doc = {id, t, [w.label]: balanceMessage[1], [w.quantity]: balanceMessage[2], ip};

    if (code !== 0) {
        doc.code = code;
        mongo[c].collection(w.withdrawLogs).insertOne(doc);
    } else {
        doc.txId = txId;
    }

    redis[c][w.lpush](id + w.balance, JSON.stringify(balanceMessage));
    mongo[c].collection(w.balance + getCluster(id)).insertOne(doc);
    if (mainAccount) {
        publish({
            [w.individuals]: [{
                [w.id]: mainAccount,
                [w.msg]: {[w.counter + w.withdraw]: newCounter}
            }]
        }, mainAccountCluster);
    }
    publish({
        [w.individuals]: [{
            id,
            [w.msg]: {[w.balance]: balanceMessage, free, fundingFree, [w.counter + w.withdraw]: newCounter}
        }]
    }, c);

    callback(code !== 0, code ? w.HOT_WALLET_EMPTY_PLEASE_CONTACT_THE_SUPPORT : txId);
};

router['c-' + w.withdraw] = async (id, c, json, callback) => {
    await takeLockAsync(c + id + w.withdraw);
    const token = genRandomString(32);
    await redis[w.minus + c][w.setAsync](w.withdraw + token, id);
    let [email, pgp] = await redis[c][w.hmgetAsync](id + w.map, w.email, w.pgp);
    if (pgp === w.true) ({pgp} = await mongo[c].collection(w.users).findOne({[w.mongoId]: ObjectId(id)}));
    await redis[w.minus + c][w.lpushAsync](w.email, JSON.stringify({
        to: email, subject: "Withdraw request", pgp,
        html: '<p>Hello,<br/><br/>Your token to withdraw is: <b>' + token + '</b></p>'
    }));
    callback(false, w.EMAIL_SENT_CHECK_YOUR_SPAMS);
};