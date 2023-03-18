const async = require('async'),
    co = require('./constants'),
    w = require('./words'),
    redis = require('./redis'),
    router = require('./router'),
    {takeLockAsync} = require("./utilities/lock"),
    {formatRedisList} = require("./utilities/commons"),
    {initAccount} = require("./services/account/initAccount"),
    userEvents = {};

module.exports.open = async function (ws) {
    if (!userEvents[ws.session[w.id]]) userEvents[ws.session[w.id]] = {};
    const id = +new Date() + ws.key;
    ws[w.id] = id;
    ws[w.api] = ws.session[w.api];
    userEvents[ws.session[w.id]][id] = ws;
    if (ws.queue) ws.queue = async.queue(userEvent, 1);
    await snapshot(ws.session[w.id], ws.session[w.cluster], ws);
};

module.exports.message = async function (ws, json) {
    try {
        const message = JSON.parse(json);
        if (!router[message[w.message]]) return;
        (ws.queue ? ws.queue.push : userEvent)({...ws.session, message}, (result) => {
            try {
                ws.send(result);
            } catch (e) {

            }
        });
        if (ws.queue && ws.queue.length() >= 1000) ws.close();
    } catch (e) {
        if (co.isDev) console.log(e);
    }
};

module.exports.close = function (ws) {
    try {
        delete userEvents[ws.session[w.id]][ws.id];
        if (ws.queue) ws.queue.kill();
    } catch (e) {
    }
};

function userEvent(params, callback) {
    const {id, c, message, ip} = params;
    if (co[w.maintenance]) return callback(JSON.stringify({error: true, data: w.MAINTENANCE}));
    router[message[w.message]](
        id, c, message, (error, data) => {
            callback(JSON.stringify({error, data, [w.id]: message[w.id]}));
        }, {ip})
        .catch((e) => {
            if (!w[e]) console.log(e);
            callback(JSON.stringify({error: true, data: w[e] || w.UNKNOWN_ERROR, [w.id]: message[w.id]}));
        });
}

const indexes = {
        [w.balance]: 1,
        [w.closedOrders]: 2,
        [w.openOrders]: 3,
        [w.BTCList]: 4,
        [w.map]: 5,
        [w.subAccount]: 6
    },
    max = 20;

async function snapshot(id, c, ws) {
    try {
        await takeLockAsync(c + id + w.snapshot);

        let replies;
        const commands = [];

        commands.push([w.hgetall, id]);
        commands.push([w.lrange, id + w.balance, 0, -1]);
        commands.push([w.lrange, id + w.closedOrders, 0, -1]);
        commands.push([w.smembers, id + w.openOrders]);
        commands.push([w.lrange, id + w.borrowed, 0, -1]);
        commands.push([w.hgetall, id + w.map]);
        commands.push([w.hgetall, id + w.subAccount]);
        replies = await redis[c].multi(commands).execAsync();

        if (!replies[0]) replies[0] = {};
        replies[0][w.BTCList] = replies[indexes[w.BTCList]];
        const now = Date.now();
        initAccount(replies[0], false, false, null, now, c);

        if (!replies[indexes[w.map]]) {
            replies[indexes[w.map]] = {};
        } else {
            replies[0][w.dailyCheck] = replies[indexes[w.map]][w.dailyCheck];
        }

        const mapData = ws[w.api] ? {} : replies[indexes[w.map]];
        const message = {...replies[0], ...mapData, [w.type]: w.snapshot};

        if (replies[indexes[w.map]][w.legacy]) message[w.legacy] = replies[indexes[w.map]][w.legacy];
        if (replies[indexes[w.map]][w.bech32]) message[w.bech32] = replies[indexes[w.map]][w.bech32];


        message[w.balance] = formatRedisList(replies[indexes[w.balance]]);
        if (!replies[0][w.subAccount]) {
            for (let i in replies[indexes[w.subAccount]]) {
                replies[indexes[w.subAccount]][i] = JSON.parse(replies[indexes[w.subAccount]][i]);
            }
            // replies[indexes[w.subAccount]].forEach(sa => JSON.parse(sa));
            message[w.subAccount] = replies[indexes[w.subAccount]];
        }
        if (message[w.verification]) message[w.verification] = JSON.parse(message[w.verification]);
        message[w.positions] = replies[0][w.positions];
        message[w.closedOrders] = [];
        message[w.openOrders] = [];

        commands.length = 0;

        if (message[w.balance].length > max) {
            message[w.balance].length = max;
            commands.push([w.ltrim, id + w.balance, 0, max / 2]);
        }

        const openOrders = replies[indexes[w.openOrders]];

        openOrders.forEach(orderId => commands.push([w.hgetall, id + orderId]));

        const closedOrders = replies[indexes[w.closedOrders]];

        closedOrders.forEach((orderId, i) => commands.push([i > max ? w.del : w.hgetall, id + orderId]));

        if (closedOrders.length > max) commands.push([w.ltrim, id + w.closedOrders, 0, max]);

        if (!commands.length && !message[w.positions][w.BTC] && message[w.margin] > 0) {
            commands.push([w.hset, id, w.margin, 0]);
            message[w.margin] = 0;
        }
        dailyCheck(id, c, message, now);

        if (commands.length) replies = await redis[c].multi(commands).execAsync();
        commands.length = 0;

        for (let i = 0; i < openOrders.length + closedOrders.length; i++) {
            const order = replies[i];
            if (order && order[w.symbol]) {
                if (order[w.status] === w.opened) {
                    message[w.openOrders].push(order);
                } else {
                    // if (order[w.symbol] !== w.BTC && !closedOrders.includes(order[w.id])) {
                    //     commands.push([w.srem, id + w.openOrders, order[w.id]]);
                    //     commands.push([w.lpush, id + w.closedOrders, order[w.id]]);
                    // }
                    message[w.closedOrders].push(order);
                }
            } else {
                if (i < openOrders.length) {
                    commands.push([w.srem, id + w.openOrders, openOrders[i]]);
                }
                commands.push([w.del, id + openOrders[i]])
            }
        }

        if (commands.length) redis[c].multi(commands)[w.exec]();

        if (message[w.referral] === w.true) message[w.referral] = id + "_" + c;
        else delete message[w.referral];

        if (!co.isDev) {
            delete message[w.id];
            delete message[w.cluster];
            for (let key in message) {
                delete message[key + w.buyUsed];
                delete message[key + w.sellUsed];
            }
            for (let key in message[w.positions]) delete message[w.positions + key];
            delete message[w.BTCList];
            delete message[w.interests];
            delete message[w.leverage];
            delete message[w.initMarginLocked];
            delete message[w.marginLocked];
            delete message[w.toBorrow];
            delete message[w.toReturn];
            delete message[w.exposure];
        } else {
            message[w.id] = id;
        }
        ws.send(JSON.stringify(message));
    } catch (e) {
    }

}

function dailyCheck(id, c, data, now) {
    if (!data[w.dailyCheck] || ((Number(data[w.dailyCheck]) + 60 * 60 * 24 * 1000) < now)) {
        const commands = [];
        commands.push([w.hset, id + w.map, w.dailyCheck, now]);
        commands.push([w.hset, id, w.counter + w.order, 0]);
        commands.push([w.hset, id, w.counter + w.withdraw, 0]);
        redis[c].multi(commands)[w.exec]();
    }
}

const heartbeat = JSON.stringify({hb: 1});

function heartBeat() {
    for (let i in userEvents) {
        for (let y in userEvents[i]) {
            try {
                userEvents[i][y].send(heartbeat);
            } catch (e) {

            }
        }
    }
    setTimeout(heartBeat, 5000);
}

heartBeat();

module.exports.userEvents = userEvents;