const redis = require('../../redis'),
    w = require('../../words'),
    {crc} = require("../../utilities/commons"),
    map = {};

function buildOrderBook(side, id, s) {
    let sum = 0, low = 0, high = 0, order, price;
    for (let i = 0; i < side.length; i += 2) {
        order = JSON.parse(side[i]);
        if (order[w.hidden] === w.true) continue;
        price = Math.abs(side[i + 1]);
        if (!low || low > price) low = price;
        if (!high || high < price) high = price;
        if (!map[s][id][price]) map[s][id][price] = 0;
        map[s][id][price] += order[w.quantity];
        sum += order[w.quantity];
    }
    map[s][id][0] = crc(buildString(s, id));
    return [sum, low, high];
}

function update(symbol, c, message, price, operation, quantity, side) {
    if (operation === w.minus) {
        if (!map[symbol][side][price]) {
            getOrderBook(symbol, c);
            return false;
        } else {
            map[symbol][side][price] -= quantity;
            if (map[symbol][side][price] < 0) {
                getOrderBook(symbol, c);
                return false;
            }
            if (map[symbol][side][price] === 0) delete map[symbol][side][price];
        }
        if (symbol === w.BTC) map[symbol][2] -= quantity;
    } else if (operation === w.plus) {
        if (!map[symbol][side][price]) map[symbol][side][price] = 0;
        map[symbol][side][price] += quantity;
        if (symbol === w.BTC) map[symbol][2] += quantity;
    }
    return true;
}

function updateOrderBook(s, c, message, newCRC) {
    if (newCRC && isCRCEqual(newCRC, map[s])) return;
    let bidsChanged, asksChanged;
    for (let x in message) {
        const [price, operation, quantity, side] = message[x];
        if (side === 0 && !bidsChanged) bidsChanged = true;
        if (side === 1 && !asksChanged) asksChanged = true;
        if (!update(s, c, message, price, operation, quantity, side)) {
            console.log(s, message, newCRC, "load ob again", map[s]);
            return true;
        }
    }
    if (bidsChanged) map[s][0][0] = crc(buildString(s, 0));
    if (asksChanged) map[s][1][0] = crc(buildString(s, 1));
    if (newCRC && !isCRCEqual(newCRC, map[s])) return true;
}

function isCRCEqual(crc, ob) {
    return ob[0][0] === crc[0] && ob[1][0] === crc[1];
}

function buildString(s, side) {
    let str = "";
    for (let p in map[s][side]) {
        if (p === "0") continue;
        str += (p + ":" + map[s][side][p]);
    }
    return str;
}

function getOrderBookCRC(s, c, updates) {
    updateOrderBook(s, c, updates);
    return [map[s][0][0], map[s][1][0]];
}

function getOrderBook(s, c) {
    map[s] = [{}, {}, 0];
    redis[c][w.zrangebyscore](s + w.bids, w.minusInf, 0, w.WITHSCORES, function (err, bids) {
        if (!err) {
            redis[c][w.zrangebyscore](s + w.asks, 0, w.plusInf, w.WITHSCORES, function (err, asks) {
                if (!err) {
                    buildOrderBook(bids, 0, s);
                    const [sum, high, low] = buildOrderBook(asks, 1, s);
                    if (s === w.BTC) map[s][2] = sum;
                    else map[s][2] = [high, low];
                }
            });
        }
    });
}

module.exports.map = map;
module.exports.getOrderBook = getOrderBook;
module.exports.getOrderBookCRC = getOrderBookCRC;
module.exports.updateOrderBook = updateOrderBook;