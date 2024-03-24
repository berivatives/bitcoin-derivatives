const cluster = require('cluster'),
    clients = require('../WebSocketMarket').map,
    userEvents = require('../WebSocketAccount').userEvents,
    tickers = require('../services/markets/tickers'),
    redis = require('../redis'),
    co = require('../constants'),
    w = require('../words'),
    {channels, initChannels} = require("../services/markets/channels"),
    {getOrderBook, updateOrderBook} = require("../services/markets/orderBooks");

exports.communicate = function (message) {
    try {
        const symbol = message[w.symbol];

        if (message[w.newMarket]) {
            redis[w.plus + message[w.cluster]][w.hgetall](symbol + w.ticker, function (err, res) {
                if (err) return;
                tickers[symbol] = res;
                initChannels(symbol);
                getOrderBook(symbol, message[w.cluster]);
                if (cluster.isMaster && co[w.cluster] === "" + message[w.cluster] && co[w.ip] === co.machines[co[w.cluster]][0]) {
                    const {initEventsQueue} = require("../services/master/eventsQueue");
                    // noinspection JSIgnoredPromiseFromCall
                    initEventsQueue(symbol, message[w.cluster]);
                }
            });
        }

        if (message[w.orderBook] && message[w.orderBook].length) {
            updateOrderBook(symbol, tickers[symbol][w.cluster], message[w.orderBook], message[w.crc]);
            message[w.orderBook].push(message[w.crc]);
            sendMessage(
                channels[symbol][w.orderBook],
                buildMessage(symbol, w.orderBook, message[w.orderBook])
            );
        }

        if (message[w.historic] && message[w.historic].length) {
            sendMessage(
                channels[symbol][w.historic],
                buildMessage(symbol, w.historic, message[w.historic])
            );
            tickers[symbol][w.lastValue] = message[w.historic][message[w.historic].length - 1][0];
        }

        if (message[w.candle]) {
            const interval = message[w.interval];
            if (interval === w.oneSecondCandle) {
                tickers[symbol][w.lastValue] = message[w.candle][4];
            }
            sendMessage(
                channels[symbol][interval],
                buildMessage(symbol, interval, message[w.candle])
            );
        }

        for (let i in message[w.individuals]) {
            sendMessage(
                userEvents[message[w.individuals][i][w.id]],
                JSON.stringify(message[w.individuals][i][w.msg]),
                true,
                message[w.individuals][i][w.msg]
            );
        }

        for (let i in message[w.orders]) {
            const [id, orderId, c] = message[w.orders][i];
            if (userEvents[id]) {
                redis[c].hgetall(id + orderId, function (err, result) {
                    if (!err && result) {
                        sendMessage(userEvents[id], JSON.stringify({[w.order]: result}), true);
                    }
                });
            }
        }

        if (message[w.maintenance]) {
            co[w.maintenance] = message[w.maintenance] === w.plus ? 1 : 0;
        }

        if (message[w.cache]) {
            for (let s in tickers) {
                if (tickers[s]) getOrderBook(s, tickers[s][w.cluster]);
            }
        }

        if (message[w.fee]) {
            co.feesMaker = message[w.fee][0];
            co.feesTaker = message[w.fee][1];
        }

    } catch (e) {
        // console.log(e);
    }
};

function sendMessage(channel, message, account, api) {
    for (let x in channel) {
        if (api === false && clients[x] && clients[x][w.api]) continue;
        if (!account && clients[x]) {
            clients[x].send(message);
        } else if (account) {
            channel[x].send(message);
        } else {
            delete channel[x];
        }
    }
}

function buildMessage(symbol, channel, data) {
    return JSON.stringify({
        [w.symbol]: symbol,
        [w.channel]: channel,
        [w.data]: data
    })
}