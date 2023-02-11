const {strictEqual} = require('assert');
const WebSocket = require('ws');
const w = require('../words');
const {clearCache} = require("./clearCache");
const {order, createUser} = require("./utilities");
const redis = require("../redis");

(async () => {

    await clearCache();
    for (let i = 0; i < 100; i++) {
        await order({q: 1e8, s: 'ETH', a: 's', p: 1e8, e: 'GTC'}, await createUser([w.free, 2e8]));
        await order({q: 1e8, s: 'ETH', a: 'b', p: 1e8, e: 'GTC'}, await createUser([w.free, 2e8]));
        strictEqual(await redis[w.plus + 0].llenAsync('ETH' + w.historic), i > 29 ? 30 : i + 1);
    }
    const ws = new WebSocket('ws://localhost:8000/markets');

    ws['on']('open', async function open() {
        ws.send(JSON.stringify({channels: [w.historic], symbol: 'ETH', type: w.subscribe}));
    });

    ws['on']('message', async function message(data) {
        const json = JSON.parse(data);
        if (json.c === 't') return;
        if (json.c === w.historic) {
            if (json.t === w.snapshot) {
                strictEqual(json.d.length, 30);
                strictEqual(json.d[0][0], 1e8);
                strictEqual(json.d[0][1], 1e8);
                strictEqual(json.d[0][3], 1);
                strictEqual(json.d[0][2] < json.d[1][2], true);
                await order({q: 1e8 / 2, s: 'ETH', a: 'b', p: 2e8, e: 'GTC'}, await createUser([w.free, 2e8]));
                await order({q: 1e8 / 2, s: 'ETH', a: 's', p: 2e8, e: 'GTC'}, await createUser([w.free, 2e8]));
            } else {
                strictEqual(await redis[w.plus + 0].llenAsync('ETH' + w.historic), 30);
                strictEqual(await redis[w.plus + 0].lindexAsync('ETH' + w.historic, 29), JSON.stringify(json.d[0]));
                strictEqual(json.d[0][0], 2e8);
                strictEqual(json.d[0][1], 1e8 / 2);
                strictEqual(json.d[0][3], 0);
                process.exit(0);
            }
        }
    });

    ws['on']('error', function error() {
    });

    ws['on']('close', function close() {
    });

})();
