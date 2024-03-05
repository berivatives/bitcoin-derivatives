const {strictEqual} = require('assert');
const w = require('../words');
const {clearCache} = require("./clearCache");
const {httpGet, query, order, createUser} = require("./utilities");
const redis = require("../redis");
const {wait} = require("../utilities/commons");
const {intervals} = require("../services/markets/candle");

let data;

(async () => {

    if (new Date().getSeconds() > 55) await wait(7000);
    await clearCache();
    await order({q: 1e8, s: 'ETH', a: 's', p: 1e8, e: 'GTC'}, await createUser([w.free, 20e8]));
    for (let i in intervals) strictEqual(await redis[0].zcardAsync('ETH' + i), 0);
    await order({q: 1e8, s: 'ETH', a: 'b', p: 1e8, e: 'GTC'}, await createUser([w.free, 2e8]));
    await wait(100);
    for (let i in intervals) strictEqual(await redis[w.plus + 0].zcardAsync('ETH' + i), 1, "bug for interval " + i);
    await wait(1000);
    await order({q: 1e8, s: 'ETH', a: 's', p: 1e8 * 1.5, e: 'GTC'}, await createUser([w.free, 2e8]));
    await order({q: 1e8, s: 'ETH', a: 'b', p: 1e8 * 1.5, e: 'GTC'}, await createUser([w.free, 2e8]));
    await wait(100);
    let lastCandle;
    for (let i in intervals) {
        const supposedLength = i.includes('S') ? true : 1;
        let realLength = await redis[w.plus + 0].zcardAsync('ETH' + i);
        if (i.includes('S')) realLength = realLength >= 1 && realLength <= 2;
        strictEqual(realLength, supposedLength, new Date() + " bug for interval " + i + " " + JSON.stringify(await redis[w.plus + 0].zrangeAsync('ETH' + i, 0, -1)));
        ({data} = await httpGet('/' + w.candles + query({symbol: 'ETH', start: 0, end: Date.now(), interval: i})));
        if (i.includes('S')) realLength = data.length >= 1 && data.length <= 2;
        else realLength = data.length;
        strictEqual(realLength, supposedLength, new Date() + " bug for interval " + i + " " + JSON.stringify(await redis[w.plus + 0].zrangeAsync('ETH' + i, 0, -1)));
        if (i === '1D') lastCandle = data[data.length - 1];
    }


    /*******check the max length return by the candles API call******/
    let i = 2500;
    const commands = [];
    while (i > 2) {
        const candle = [lastCandle[0] - (i * 3600 * 24 * 1000), 1, 2, 3, 4, 5, 6, lastCandle[7] - (i * 3600 * 24 * 1000)];
        commands.push([w.zadd, 'ETH1D', candle[0], JSON.stringify(candle)]);
        i--;
    }
    await redis[w.plus + 0].multi(commands).execAsync();

    ({error, data} = await httpGet('/' + w.candles + query({
        symbol: 'ETH',
        start: 0,
        end: Date.now(),
        interval: '1D'
    })));
    strictEqual(data.length <= 2000, true);
    strictEqual(JSON.stringify(data[0]), JSON.stringify([lastCandle[0] - (2500 * 3600 * 24 * 1000), 1, 2, 3, 4, 5, 6, lastCandle[7] - (2500 * 3600 * 24 * 1000)]));
    strictEqual(await redis[w.plus + 0].zcardAsync('ETH1D'), 2499);
    /*******check the max length return by the candles API call******/


    /*******update ticker volume after 1minute candle close******/
    await clearCache();
    await redis[w.plus + 0].hsetAsync('ETH' + w.ticker, w.volume, 2e8);
    const yesterday = new Date(Date.now() - 3600 * 1000 * 24);
    yesterday.setUTCSeconds(0);
    const start = yesterday.setUTCMilliseconds(0);
    const end = yesterday.setUTCMilliseconds(60 * 1000 - 1);
    await redis[w.plus + 0].zaddAsync('ETH1', start - 3600 * 1000 * 24, JSON.stringify([start - 3600 * 1000 * 24, 1, 1, 1, 1, 1e8, 1e8, end - 3600 * 1000 * 24]));
    await redis[w.plus + 0].zaddAsync('ETH1', start, JSON.stringify([start, 1, 1, 1, 1, 1e8, 1e8, end]));
    await order({q: 3e8, s: 'ETH', a: 's', p: 2e8, e: 'GTC'}, await createUser([w.free, 10e8]));
    await order({q: 3e8, s: 'ETH', a: 'b', p: 2e8, e: 'GTC'}, await createUser([w.free, 10e8]));
    await wait(500);
    strictEqual(await redis[w.plus + 0].hgetAsync('ETH' + w.ticker, w.volume), '700000000');
    strictEqual(await redis[w.plus + 0].hgetAsync('ETH' + w.ticker, w.name), "Ethereum");
    strictEqual(await redis[w.plus + 0].hgetAsync('ETH' + w.ticker, w.multiplier), "6");
    /*******update ticker volume after 1minute candle close******/


    process.exit(0);
})();
