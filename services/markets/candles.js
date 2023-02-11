const w = require('../../words'),
    {openCandle, intervals, sortedIntervals} = require('./candle'),
    router = require('../../router'),
    tickers = require('./tickers'),
    redis = require('../../redis'),
    {isBan, formatRedisList} = require("../../utilities/commons");

exports.updateCandles = (symbol, now, open, high, low, close, volume, btcVolume, candles) => {
    if (!candles) return;
    let candle, oneSecondCandleHasEnded, oneMinuteCandleHasEnded, temp;
    const {c} = tickers[symbol], commands = [], commandsPublish = [];
    sortedIntervals.forEach((interval, i) => {
        if (candles[i].length) {
            candle = JSON.parse(candles[i][0]);
            if (now > candle[7]) { // end candle
                if (interval === w.oneSecondCandle) oneSecondCandleHasEnded = true;
                if (interval === w.oneMinuteCandle) {
                    oneMinuteCandleHasEnded = true;
                    removeLastDay1MinuteVolume(symbol, c, candle[0]);
                } else if (interval === w.dailyCandle) {
                    commands.push([w.hset, symbol + w.ticker, w.volume, candle[6]]);
                }
                publishCandle(commandsPublish, symbol, interval, candle);
                temp = candle;
                candle = openCandle(interval, open, high, low, close, volume, btcVolume);
                for (let y = 1; y < 7; y++) temp[y] *= 0;
                while (temp[7] + 1 < candle[0]) {
                    const duration = intervals[interval];
                    temp[0] += duration;
                    temp[7] += duration;
                    if (interval === w.oneMinuteCandle) removeLastDay1MinuteVolume(symbol, c, temp[0]);
                }
                commands.push([w.zadd, symbol + interval, candle[0], JSON.stringify(candle)]);
            } else { // update candle
                commands.push([w.zremrangebyscore, symbol + interval, candle[0], candle[0]]);
                if (candle[2] < high) candle[2] = high;
                if (candle[3] > low) candle[3] = low;
                candle[4] = close;
                candle[5] += volume;
                candle[6] += btcVolume;
                commands.push([w.zadd, symbol + interval, candle[0], JSON.stringify(candle)]);
            }
            if (oneSecondCandleHasEnded) publishCandle(commandsPublish, symbol, interval, candle);
        } else {
            candle = openCandle(interval, open, high, low, close, volume, btcVolume);
            commands.push([w.zadd, symbol + interval, candle[0], JSON.stringify(candle)]);
        }

        if (interval === w.oneMinuteCandle) commands.push([w.hincrby, symbol + w.ticker, w.volume, btcVolume]);

        if (interval === w.dailyCandle) commands.push([w.hmset, symbol + w.ticker, w.lastValue, close, w.variation, (100 * (candle[4] - candle[1]) / candle[1]).toFixed(2)]);
    });

    redis[w.plus + c][w.multi](commands)[w.exec]();
    redis[w.minus + c][w.multi](commandsPublish)[w.exec]();
};

function publishCandle(commands, symbol, interval, candle) {
    commands.push([w.publish, w.events, JSON.stringify({
        [w.symbol]: symbol,
        [w.interval]: interval,
        [w.candle]: candle
    })]);
}

function removeLastDay1MinuteVolume(symbol, c, timestamp) {
    const yesterday = Math.round(timestamp - 3600 * 24 * 1000);
    redis[w.plus + c][w.zrangebyscore](symbol + w.oneMinuteCandle, yesterday, yesterday, function (err, result) {
        if (!err && result.length) {
            try {
                const candle = JSON.parse(result[0]);
                if (candle && candle[6]) redis[w.plus + c][w.hincrby](symbol + w.ticker, w.volume, Math.round(candle[6] * -1));
            } catch (e) {
            }
        }
    });
}

router[w.noUserCheck][w.candles] = true;

router[w.candles] = async (id, c, json, callback, args) => {
    const {symbol, interval, start, end} = json;
    if (isNaN(start * 1) || isNaN(end * 1) || start > end) throw w.BAD_RANGE_DATE;
    if (!tickers[symbol]) throw w.UNKNOWN_SYMBOL;
    if (!intervals[interval]) throw w.UNKNOWN_INTERVAL;
    if (!args.res) throw w.IMPOSSIBLE_OPERATION;
    await isBan(args[w.ip]);
    callback(false, formatRedisList(await redis[w.plus + tickers[symbol][w.cluster]][w.zrangebyscoreAsync](symbol + interval, start * 1, end * 1, w.LIMIT, 0, 2000)));
};
