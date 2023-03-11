const Redis = require('redis'),
    bitcoin = require('bitcoinjs-lib'),
    zmq = require('zeromq'),
    {ObjectId} = require('mongodb'),
    co = require('../../constants'),
    w = require('../../words'),
    mongo = require('../../mongo'),
    redis = require('../../redis'),
    {publish, wait, getCluster} = require("../../utilities/commons"),
    bitcoinRPC = require('../../utilities/bitcoinRPC'),
    {initAccount} = require("../account/initAccount"),
    equity = require('../wallet/equity'),
    map = {},
    unconfirmedTransactions = {};

(async () => {
    while (!mongo[co[w.cluster]]) await wait(1000);
    mongo[co[w.cluster]].collection(w.addresses).find().forEach(function (doc) {
        if (doc) map[doc[w.address]] = [doc[w.id], doc[w.cluster]];
    }, function (err) {
        if (err) {
            process.exit(0);
        } else {
            getTransactionsList();
            checkConfirmations();
        }
    });
})();

const sock = zmq.socket('sub');
sock.connect('tcp://' + co.bitcoinIP + ':' + (co.bitcoinPort * 1 + 1));
sock.subscribe('rawtx');

sock.on('message', function (topic, message) {
    try {
        if (topic.toString() === 'rawtx') {
            const tx = bitcoin.Transaction.fromBuffer(message);
            for (let i in tx.outs) {
                if (map[bitcoin.address.fromOutputScript(tx.outs[i].script)]) {
                    unconfirmedTransactions[tx.getId()] = true;
                }
            }
        }
    } catch (e) {

    }
});

const client = Redis.createClient(co.redisClusters[w.minus + co[w.cluster]]);

client.on('error', function (err) {
});

client.on('connect', function () {
    client.subscribe(w.addresses);
    client.subscribe(w.deposits);
});

client.on('message', async function (channel, message) {
    try {
        const json = JSON.parse(message);
        if (channel === w.addresses) {
            map[json[w.address]] = [json[w.id], json[w.cluster]];
        } else if (channel === w.deposits) {
            const [id, c, txId, amount, balanceMsg, address] = json;
            await saveDeposit(id, c, txId, amount, balanceMsg, address);
        }
    } catch (e) {
    }
});

client.on("unsubscribe", function (channel) {
    client.subscribe(channel);
});

function checkConfirmations() {
    for (let txId in unconfirmedTransactions) {
        // noinspection JSIgnoredPromiseFromCall
        addDeposit(txId);
    }
    setTimeout(checkConfirmations, 5 * 60 * 1000);
}

async function addDeposit(txId) {
    try {
        const {code, result} = await bitcoinRPC('gettransaction', [txId]);
        if (code !== 0) return;
        const {details, confirmations, blocktime, time} = result;

        const now = Date.now();

        for (let i in details) {
            const {address, amount, category, abandoned} = details[i];
            const [id, c] = map[address];

            if (!id || !c || amount < 0 || category !== 'receive' || abandoned) {
                delete unconfirmedTransactions[txId];
                continue;
            }

            if (!confirmations || confirmations < co.confirmations) {
                if (time > ((now - 3600 * 48 * 1000) / 1000)) {
                    delete unconfirmedTransactions[txId];
                    return;
                }
                unconfirmedTransactions[txId] = true;
                continue;
            }

            if (!(await redis[c][w.zaddAsync](w.deposits, blocktime, id + txId))) {
                delete unconfirmedTransactions[txId];
                continue;
            }

            await mongo[c].collection(w.deposits).insertOne({id, [w.data]: id + txId});
            delete unconfirmedTransactions[txId];
            const qty = Math.round(amount * co.satoshi);
            const balanceMsg = [now, "Bitcoin deposit", qty, txId];
            await saveDeposit(id, c, txId, qty, balanceMsg, address);
            const user = await mongo[c].collection(w.users).findOne({[w.mongoId]: ObjectId(id)});
            if (!user) return;
            const {email, pgp} = user;
            await redis[w.minus + c][w.lpushAsync](w.email, JSON.stringify({
                to: email, subject: "Deposit", pgp,
                html: '<p>Hello,<br/><br/>Your bitcoin deposit of <b>' + amount + '</b> has been credited to your account.<br/><br/>Transaction ID (TxID):' + txId + '<br/><br/>Regards</p>'
            }));
        }
    } catch (e) {
        console.log(e);
    }
}

async function saveDeposit(id, c, txId, amount, balanceMsg, address) {
    try {
        const commands = [
            [w.hincrby, id, w.free, amount],
            [w.hincrby, id + w.map, w.addressUsed + (address.startsWith('bc1') ? w.bech32 : w.legacy), address.length ? 1 : 0],
            [w.lpush, id + w.balance, JSON.stringify(balanceMsg)],
            [w.hgetall, id],
            [w.lrange, id + w.borrowed, 0, -1]
        ];
        const replies = await redis[c].multi(commands)[w.execAsync]().catch(e => console.log(e));
        const account = replies[replies.length - 2];
        account[w.BTCList] = replies[replies.length - 1];
        initAccount(account, false, false, null, balanceMsg[0], c);
        await equity(id, c, account);
        publish({
            [w.individuals]: [{
                id,
                [w.msg]: {
                    [w.balance]: balanceMsg,
                    [w.free]: Math.round(account[w.free]),
                    [w.locked]: Math.round(account[w.locked]),
                    [w.margin]: Math.round(account[w.margin])
                }
            }]
        }, c);
        const [t, l, q] = balanceMsg;
        await mongo[c].collection(w.balance + getCluster(id)).insertOne({id, t, l, q, txId});
    } catch (e) {
        console.log(e);
    }
}

async function getTransactionsList(lastTime) {
    try {
        const {code, result} = await bitcoinRPC('listtransactions', ['*', 500]);
        if (!code) {
            for (let i in result) {
                const {amount, abandoned, time, confirmations, txid} = result[i];
                if (amount > 0 && !abandoned) {
                    if (lastTime && time < lastTime) continue;
                    if (confirmations >= co.confirmations) {
                        // noinspection ES6MissingAwait
                        addDeposit(txid);
                    } else {
                        unconfirmedTransactions[txid] = true;
                    }
                }
            }
        }
    } catch (e) {

    }
}