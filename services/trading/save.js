const fs = require('fs'),
    redis = require('../../redis'),
    mongo = require('../../mongo'),
    co = require('../../constants'),
    w = require('../../words'),
    {triggerStops} = require("./stop"),
    {sortedIntervals} = require("../markets/candle"),
    {updateCandles} = require("../markets/candles"),
    {getOrderBookCRC} = require("../markets/orderBooks"),
    {borrowBitcoin, mustReturnBitcoin} = require("./borrow"),
    returnBTC = require('../funding/positionFunding'),
    {publish, saveOrder, getCluster, osCommand} = require('../../utilities/commons');

exports.save = async function (individuals, orders, orderBookUpdates, trades, symbol, cs, csc, now, commands, balances, accounts, takerId, isFunding) {
    const marketCommands = [];
    let open, high = null, low = null, close, volume = 0, btcVolume = 0;
    if (trades.length) {
        sortedIntervals.forEach(interval => marketCommands.push([w.zrevrange, symbol + interval, 0, 0]));
        open = trades[0][0];
        for (let i in trades) {
            close = trades[i][0];
            volume += trades[i][1];
            btcVolume += trades[i][0] * trades[i][1] / co.satoshi;
            if (!high || high < close) high = close;
            if (!low || low > close) low = close;
            marketCommands.push([w.rpush, symbol + w.historic, JSON.stringify(trades[i])]);
        }
        marketCommands.push([w.ltrim, symbol + w.historic, -30, -1]);
    }

    if (!commands[csc].length) throw w.ORDER_KILLED;

    if (trades.length) {
        for (let id in accounts) {
            const c = accounts[id][w.cluster];

            if (!isFunding) {
                const pos = accounts[id][w.positions][symbol];
                if (pos) commands[c].push([w.hset, id, w.positions + symbol, JSON.stringify(pos)]);
                individuals[c][1].push({
                    id,
                    [w.msg]: {[w.symbol]: symbol, [w.positions]: pos}
                });
            } else {
                if (accounts[id][w.BTC]) {
                    individuals[c][1].push({
                        id,
                        [w.msg]: {[w.symbol]: symbol, [w.positions]: accounts[id][w.BTC]}
                    });
                }
            }

            if (accounts[id][w.free] > 0 && accounts[id][w.marginLocked] > 0) {
                const amount = accounts[id][w.free] > accounts[id][w.marginLocked] ? accounts[id][w.marginLocked] : accounts[id][w.free];
                commands[c].push([w.hincrby, id, w.free, Math.round(amount * -1), w.margin, Math.round(amount * -1), w.locked, Math.round(amount)]);
                accounts[id][w.toReturn] += amount;
                if (accounts[id][w.free] > accounts[id][w.marginLocked]) {
                    accounts[id][w.free] -= amount;
                    accounts[id][w.margin] -= amount;
                    accounts[id][w.locked] += amount;
                    accounts[id][w.marginLocked] = 0;
                } else {
                    accounts[id][w.locked] += amount;
                    accounts[id][w.marginLocked] -= amount;
                    accounts[id][w.margin] -= amount;
                    accounts[id][w.free] = 0;
                }
            }
        }
        if (!isFunding) {
            commands[csc].push([w.zrangebyscore, symbol + w.asks + w.STOP, low, w.plusInf]);
            commands[csc].push([w.zrangebyscore, symbol + w.bids + w.STOP, 0, high]);
        }
    }

    for (let id in accounts) {
        individuals[accounts[id][w.cluster]][1].push({
            id,
            [w.msg]: symbol === w.BTC ? {
                [w.fundingFree]: Math.round(accounts[id][w.fundingFree]),
                [w.fundingLocked]: Math.round(accounts[id][w.fundingLocked])
            } : {
                [w.free]: Math.round(accounts[id][w.free]),
                [w.locked]: Math.round(accounts[id][w.locked]),
                [w.margin]: Math.round(accounts[id][w.margin])
            }
        });
    }

    if (co.isDev && takerId === '0killob') await osCommand("/bin/sh", ["./scripts/stopredis.sh"]);

    const replies = await redis[cs][w.multi](commands[csc]).execAsync().catch((e) => {
        console.log(e);
        return null;
    });
    if (!replies) throw w.UNKNOWN_ERROR;

    for (let c in commands) {
        if (c === csc) continue;
        const mergedCommands = [], hincrby = {};
        for (let i in commands[c]) {
            const command = commands[c][i];
            if (command[0] === w.hincrby) {
                const id = command[1];
                if (!hincrby[id]) hincrby[id] = {};
                for (let i = 2; i < command.length; i += 2) {
                    const key = command[i], value = command[i + 1];
                    if (!hincrby[id][key]) hincrby[id][key] = value;
                    else hincrby[id][key] += value;
                }
                delete commands[c][i];
            } else {
                mergedCommands.push(command);
            }
        }
        let checkBTCLend;
        for (let id in hincrby) {
            mergedCommands.push([w.hincrby, id, ...oneLineIncrement(hincrby[id])]);
            if (id === takerId && isFunding && trades.length) {
                checkBTCLend = mergedCommands.length;
                mergedCommands.push([w.hgetall, id]);
                mergedCommands.push([w.lrange, id + w.borrowed, 0, -1]);
            }
        }
        const commandsLength = mergedCommands.length;
        for (let i in orders[c]) mergedCommands.push([w.hgetall, orders[c][i][0] + orders[c][i][1]]);

        if (co.isDev && takerId === '0killuser') await osCommand("/bin/sh", ["./scripts/stopredis.sh"]);

        const reply = await redis[c].multi(mergedCommands).execAsync().catch((e) => {
            console.log(e);
            return null
        });

        if (!reply) {
            fs.appendFileSync(co.__dirname + + "/errors/" + now + ".json", JSON.stringify({
                c,
                mergedCommands,
                balances: balances[c]
            }));
            continue;
        }

        if (checkBTCLend) mustReturnBitcoin(takerId, c, reply[checkBTCLend], reply[checkBTCLend + 1]);

        publish({[w.individuals]: individuals[c][1], [w.orders]: individuals[c][0]}, c);

        if (co.isDev && takerId === '0killmongo') {
            for (let i in mongo) {
                console.log("close");
                mongo[i].close();
            }
        }

        for (let i in balances[c]) {
            const balance = balances[c][i];
            mongo[c].collection(w.balance + getCluster(balance[w.id])).insertOne(balance);
        }

        for (let i = commandsLength; i < reply.length; i++) {
            const [userId] = orders[c][i - commandsLength];
            const order = reply[i];
            if (order && order[w.status] !== [w.opened]) {
                if (order[w.symbol] === w.BTC && order[w.action] === w.lend) continue;
                saveOrder(userId, c, order);
            }
        }
    }

    if (!isFunding) {
        for (let id in accounts) {
            if (accounts[id][w.free] > 0 && accounts[id][w.toBorrow] > 0) {
                if (accounts[id][w.free] > accounts[id][w.toBorrow]) {
                    accounts[id][w.toBorrow] = 0;
                } else {
                    accounts[id][w.toBorrow] -= accounts[id][w.free];
                }
            }
            if (accounts[id][w.toBorrow] > 0 && accounts[id][w.toReturn] > 0) {
                if (accounts[id][w.toBorrow] > accounts[id][w.toReturn]) {
                    accounts[id][w.toBorrow] -= accounts[id][w.toReturn];
                    accounts[id][w.toReturn] = 0;
                } else if (accounts[id][w.toReturn] > accounts[id][w.toBorrow]) {
                    accounts[id][w.toReturn] -= accounts[id][w.toBorrow];
                    accounts[id][w.toBorrow] = 0;
                }
            }
            if (accounts[id][w.toBorrow] > 0) {
                accounts[id][w.id] = id;
                borrowBitcoin(accounts[id]);
            }
            if (accounts[id][w.toReturn] > 0) {
                accounts[id][w.id] = id;
                returnBTC(accounts[id], id, accounts[id][w.cluster]);
            }
        }
    }

    const crc = getOrderBookCRC(symbol, cs, orderBookUpdates);

    if (trades.length) {
        updateCandles(symbol, now, open, high, low, close, Math.round(volume), Math.round(btcVolume), await redis[w.plus + cs].multi(marketCommands).execAsync().catch(() => {
            return null;
        }));
        if (symbol !== w.BTC) {
            triggerStops(replies[replies.length - 2]);
            triggerStops(replies[replies.length - 1]);
        }
    }
    if (crc) publish({[w.symbol]: symbol, [w.orderBook]: orderBookUpdates, crc, [w.historic]: trades}, cs);
};

function oneLineIncrement(map) {
    const oneLineIncrement = [];
    for (let i in map) {
        const rounded = Math.round(map[i]);
        if (rounded) {
            oneLineIncrement.push(i);
            oneLineIncrement.push(rounded);
        }
    }
    return oneLineIncrement;
}
