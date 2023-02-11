const redis = require('../redis'),
    co = require('../constants'),
    w = require('../words'),
    {publish} = require("../utilities/commons");

if (process.argv.length !== 5) {
    console.log(process.argv);
    console.log("argv problem");
    process.exit(-1);
}

const s = process.argv[2], name = process.argv[3], multiplier = Number(process.argv[4]) || 0;

console.log(process.argv);

if (!s || !s.length || !name || !name.length || isNaN(multiplier) || multiplier < 0) {
    console.log(process.argv[0] + " " + process.argv[1] + " SYMBOL NAME MULTIPLIER");
    process.exit(-1);
}
const c = co.clusters[co.machines.length - 1];

(async () => {
    const result = await redis[0][w.saddAsync](w.tickers, JSON.stringify({s, c}));
    if (!result) {
        console.log('ticker already exists');
        process.exit(-1);
    }
    await redis[w.plus + c][w.hmsetAsync](s + w.ticker, w.name, name, w.lastValue, 0, w.variation, 0, w.volume, 0, w.multiplier, multiplier, w.cluster, c);
    publish({[w.newMarket]: true, s, c}, c);
    setTimeout(function () {
        if (co.isDev) process.exit(0);
    }, 100);
})();

