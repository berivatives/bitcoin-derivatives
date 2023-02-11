const w = require('./words'),
    co = require('./constants'),
    redis = require('./redis'),
    map = {},
    events = require('./services/markets/channels').channels,
    tickers = require('./services/markets/tickers'),
    orderBooks = require('./services/markets/orderBooks').map,
    {getIp, isBan, formatRedisList} = require("./utilities/commons");

module.exports.open = function (ws) {
    ws[w.ip] = getIp(ws);
    const id = +new Date() + ws[w.ip];
    ws[w.id] = id;
    ws[w.channel] = 0;
    map[id] = ws;
    ws.send(JSON.stringify({[w.channel]: w.tickersChannel, [w.data]: tickers}));
};

module.exports.message = async function (ws, json) {
    try {
        await isBan(ws[w.ip]);
        const {type, symbol, channels} = JSON.parse(json);
        if (type === w.subscribe && Array.isArray(channels)) {
            for (let e in channels) {
                if (ws[w.channel] > 100) return;
                if (!events[symbol] || !events[symbol][channels[e]] || isSub(symbol, channels[e], ws[w.id])) continue;
                if (channels[e] === w.historic) {
                    redis[w.plus + tickers[symbol][w.cluster]].lrange(symbol + channels[e], 0, -1, function (err, result) {
                        !err && ws.send(JSON.stringify({
                            [w.symbol]: symbol,
                            [w.channel]: channels[e],
                            [w.type]: w.snapshot,
                            [w.data]: formatRedisList(result)
                        }));
                    });
                } else if (channels[e] === w.orderBook) {
                    ws.send(JSON.stringify({
                        [w.symbol]: symbol,
                        [w.channel]: channels[e],
                        [w.type]: w.snapshot,
                        [w.data]: [orderBooks[symbol][0], orderBooks[symbol][1]]
                    }));
                }
                events[symbol][channels[e]][ws[w.id]] = true;
                ws[w.channel]++;
            }
        } else if (type === w.unsubscribe && Array.isArray(channels)) {
            for (let e in channels) {
                if (!events[symbol] || !events[symbol][channels[e]] || !isSub(symbol, channels[e], ws[w.id])) continue;
                delete events[symbol][channels[e]][ws[w.id]];
                ws[w.channel]--;
            }
        }
    } catch (e) {
        if (co.isDev) console.log(e);
    }
};

module.exports.close = function (ws) {
    delete map[ws[w.id]];
};

module.exports.map = map;

function isSub(symbol, channel, id) {
    return events[symbol][channel][id] !== undefined;
}

async function liveTickers() {
    try {
        for (let symbol in tickers) {
            const ticker = await redis[w.plus + tickers[symbol][w.cluster]][w.hgetallAsync](symbol + w.ticker);
            if (ticker) {
                tickers[symbol] = ticker;
                tickers[symbol][w.volume] *= 1;
                tickers[symbol][w.lastValue] *= 1;
                tickers[symbol][w.variation] *= 1;
            }
        }
    } catch (e) {

    }
    const message = JSON.stringify({[w.channel]: w.tickersChannel, [w.data]: tickers});
    for (let client in map) {
        try {
            map[client].send(message);
        } catch (e) {
        }
    }
    setTimeout(liveTickers, 5000);
}

// noinspection JSIgnoredPromiseFromCall
liveTickers();