const redis = require('../../redis'),
    w = require('../../words'),
    {initChannels} = require('./channels'),
    {getOrderBook} = require('./orderBooks'),
    {wait} = require('../../utilities/commons'),
    map = {};

redis[0][w.smembers](w.tickers, async function (err, symbols) {
    for (let i in symbols) {
        const {s, c} = JSON.parse(symbols[i]);
        let data = null;
        while (!data) {
            data = await redis[w.plus + c][w.hgetallAsync](s + w.ticker);
            if (data) break;
            await wait(100);
        }
        map[s] = data;
        initChannels(s);
        getOrderBook(s, c);
    }
});

module.exports = map;
