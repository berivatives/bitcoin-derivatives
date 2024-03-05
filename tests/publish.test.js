const {strictEqual} = require('assert');
const w = require('../words');
const {clearCache} = require("./clearCache");
const {wait} = require("../utilities/commons");
const WebSocket = require('ws');
const {createUser} = require("./utilities");
const {order} = require("./utilities");

let error;

let session, user, session2, user2;

(async () => {
    await clearCache();
    ws.send(JSON.stringify({symbol: "ETH", type: 'subscribe', channels: [w.orderBook, w.historic]}));
    await wait(1000);
    ({error} = await order({
        q: 1e8,
        p: 10e8,
        s: 'ETH',
        a: 's',
        e: 'GTC',
        [w.hidden]: true
    }, await createUser([w.free, 10e8])));
    strictEqual(error, false);
    [session, user] = await createUser([w.free, 5e8]);
    ({error} = await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: 'GTC'}, session));
    strictEqual(error, false);
    [session2, user2] = await createUser([w.free, 5e8]);
    ({error} = await order({q: 1e8, p: 1e8, s: 'ETH', a: 's', e: 'GTC'}, session2));
    strictEqual(error, false);

    await order({q: 1e8, p: 1e8, s: 'ETH', a: 's', e: 'GTC'}, session2);
    await order({q: 1e8, p: 1e8, s: 'ETH', a: 's', e: 'GTC'}, session2);
    await order({q: 1e8, p: 1e8, s: 'ETH', a: 's', e: 'GTC'}, session2);

    await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: 'GTC'}, session);

    await order({q: 3e8, p: 1e8, s: 'ETH', a: 'b', e: 'GTC'}, session);

})();

const messages = {
    [w.orderBook]: [
        {
            s: 'ETH',
            c: 'ob',
            t: 's',
            d: [{'0': 0}, {'0': 0}]
        },
        {
            s: 'ETH',
            c: 'ob',
            d: [[100000000, '+', 100000000, 0], [1020915517, 0]]
        },
        {
            s: 'ETH',
            c: 'ob',
            d: [[100000000, '-', 100000000, 0], [0, 0]]
        },
        {
            s: 'ETH',
            c: 'ob',
            d: [[100000000, '+', 100000000, 1], [0, 1020915517]]
        },
        {
            s: 'ETH',
            c: 'ob',
            d: [[100000000, '+', 100000000, 1], [0, 89445368]]
        },
        {
            s: 'ETH',
            c: 'ob',
            d: [[100000000, '+', 100000000, 1], [0, 305121211]]
        },
        {
            s: 'ETH',
            c: 'ob',
            d: [[100000000, '-', 100000000, 1], [0, 89445368]]
        },
        {
            s: 'ETH',
            c: 'ob',
            d: [
                [100000000, '-', 100000000, 1],
                [100000000, '-', 100000000, 1],
                [100000000, '+', 100000000, 0],
                [1020915517, 0]
            ]
        }
    ],
    [w.historic]: [
        {s: 'ETH', c: 'h', t: 's', d: []},
        (json) => {
            checkTrade([[100000000, 100000000, "ts", 0]], json);
        },
        (json) => {
            checkTrade([[100000000, 100000000, "ts", 1]], json);
        },
        (json) => {
            checkTrade([[100000000, 100000000, "ts", 1], [100000000, 100000000, "ts", 1]], json);
            process.exit(0);
        }
    ]
};

function checkTrade(msg, json) {
    strictEqual(json[w.symbol], "ETH");
    strictEqual(json[w.data].length, msg.length);
    for (let i in msg) {
        const [amount, qte, time, type] = json[w.data][i];
        strictEqual(amount, msg[i][0]);
        strictEqual(qte, msg[i][1]);
        strictEqual(start <= time && time <= Date.now(), true);
        strictEqual(type, msg[i][3]);
    }
}

const start = Date.now();

const ws = new WebSocket('ws://localhost:8000/markets');

ws['on']('open', function () {
});

ws['on']('message', function (data) {
    const json = JSON.parse(data);
    const {c} = json;
    const i = ws[c] || 0;
    if (messages[c]) {
        // console.log(i, json);
        strictEqual(messages[c][i] !== undefined, true);
        if (typeof messages[c][i] === "function") {
            messages[c][i](json);
        } else {
            strictEqual(JSON.stringify(messages[c][i]), data.toString());
        }
    }
    ws[c] = i + 1;
});

ws['on']('error', function () {
});

ws['on']('close', function () {
});