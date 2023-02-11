const redis = require('../redis');
const w = require('../words');
const co = require('../constants');
const {publish} = require("../utilities/commons");

const clearCache = async function () {
    if (!co.isDev) {
        process.exit(0);
        return;
    }
    for (let i in co.redisClusters) {
        if (typeof co.redisClusters[i] === w.string) continue;
        await redis[i]['flushdbAsync']();
        publish({[w.fee]: [0, 0], [w.cache]: true}, 0);
    }
    await redis[0][w.saddAsync](w.tickers, JSON.stringify({s: 'ETH', c: 0}));
    await redis[w.plus + 0][w.hmsetAsync]('ETH' + w.ticker, w.name, "Ethereum", w.lastValue, 0, w.variation, 0, w.volume, 0, w.multiplier, 6, w.cluster, 0);

    await redis[0][w.saddAsync](w.tickers, JSON.stringify({s: 'GOLD', c: 0}));
    await redis[w.plus + 0][w.hmsetAsync]('GOLD' + w.ticker, w.name, "Gold Ounce", w.lastValue, 0, w.variation, 0, w.volume, 0, w.multiplier, 0, w.cluster, 0);

    await redis[0][w.saddAsync](w.tickers, JSON.stringify({s: 'TSLA', c: 0}));
    await redis[w.plus + 0][w.hmsetAsync]('TSLA' + w.ticker, w.name, "Tesla", w.lastValue, 0, w.variation, 0, w.volume, 0, w.multiplier, 0, w.cluster, 0);

    await redis[0][w.saddAsync](w.tickers, JSON.stringify({s: 'BTC', c: 0}));
    await redis[w.plus + 0][w.hmsetAsync]('BTC' + w.ticker, w.name, "Bitcoin Funding", w.lastValue, 0, w.variation, 0, w.volume, 0, w.multiplier, 0, w.cluster, 0);

    await redis[0][w.saddAsync](w.tickers, JSON.stringify({s: 'BLX', c: 0}));
    await redis[w.plus + 0][w.hmsetAsync]('BLX' + w.ticker, w.name, "Bitcoin Liquid Index", w.lastValue, 0, w.variation, 0, w.volume, 0, w.multiplier, 6, w.cluster, 0);

};

exports.clearCache = clearCache;