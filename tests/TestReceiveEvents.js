const {strictEqual} = require('assert');
const w = require('../words');
const {clearCache} = require("./clearCache");
const {order, createUser} = require("./utilities");
const {wait} = require("../utilities/commons");

let session, user;

(async () => {

    await clearCache();
    [session, user] = await createUser([w.free, 1e8, w.fundingFree, 1e8]);
    const WebSocket = require('ws');
    const ws = new WebSocket('ws://localhost:8000/account?session=' + session);

    const messages = [
        null,
        {[w.free]: 0, [w.locked]: 1e8, [w.margin]: 0},
        (json) => {
            strictEqual(json[w.order] !== undefined, true);
            strictEqual(json[w.order][w.id] !== undefined, true);
            strictEqual(json[w.order][w.timestamp] !== undefined, true);
            delete json[w.order][w.id];
            delete json[w.order][w.timestamp];
            strictEqual(JSON.stringify({
                "a": w.buy,
                "s": "ETH",
                "q": "" + 1e8,
                "p": "" + 1e8,
                "e": w.GTC,
                "st": w.opened,
                "f": "0",
                "fe": "0",
                "po": "false",
                "h": "false",
                "r": "false",
                "cp": "0"
            }), JSON.stringify(json[w.order]));
        },
        {[w.symbol]: "ETH", [w.positions]: {[w.quantity]: 1e8, [w.price]: 1e8, [w.sum]: 1e8, [w.pnl]: 0}},
        {[w.free]: 0, [w.locked]: 1e8, [w.margin]: 0},
        (json) => {
            strictEqual(json[w.order] !== undefined, true);
            strictEqual(json[w.order][w.status], w.filled);
        },
        {[w.symbol]: "ETH", [w.positions]: null},
        {[w.free]: 1e8, [w.locked]: 0, [w.margin]: 0},
        (json) => {
            strictEqual(json[w.order] !== undefined, true);
            strictEqual(json[w.order][w.status], w.filled);
        },
        {[w.free]: 0, [w.locked]: 1e8, [w.margin]: 1e8},
        (json) => {
            strictEqual(json[w.order] !== undefined, true);
            strictEqual(json[w.order][w.status], w.opened);
        },
        {[w.symbol]: "ETH", [w.positions]: {[w.quantity]: 2e8, [w.price]: 1e8, [w.sum]: 2e8, [w.pnl]: 0}},
        {[w.free]: 0, [w.locked]: 1e8, [w.margin]: 1e8},
        (json) => {
            strictEqual(json[w.order] !== undefined, true);
            strictEqual(json[w.order][w.status], w.filled);
        },
        (json) => {
            strictEqual(json[w.symbol], "BTC");
            strictEqual(json[w.positions][w.quantity], 1e8);
            strictEqual(json[w.positions][w.price], 0.05e8);
            strictEqual(json[w.positions][w.pnl], 0);
        },
        {[w.fundingFree]: 1e8, [w.fundingLocked]: 0},
        (json) => {
            strictEqual(json[w.order] !== undefined, true);
            strictEqual(json[w.order][w.symbol], "BTC");
            strictEqual(json[w.order][w.status], w.filled);
        },
        {[w.free]: 0, [w.locked]: 1e8, [w.margin]: 1e8},
        (json) => {
            strictEqual(json[w.order] !== undefined, true);
            strictEqual(json[w.order][w.symbol], "ETH");
            strictEqual(json[w.order][w.status], w.opened);
        },
        {[w.symbol]: "ETH", [w.positions]: {[w.quantity]: 1.5e8, [w.price]: 1e8, [w.sum]: 2e8, [w.pnl]: 0}},
        {[w.free]: 0, [w.locked]: 1e8, [w.margin]: 0.5e8},
        (json) => {
            strictEqual(json[w.order] !== undefined, true);
            strictEqual(json[w.order][w.symbol], "ETH");
            strictEqual(json[w.order][w.status], w.filled);
        },
        (json) => {
            strictEqual(json[w.symbol], "BTC");
            strictEqual(json[w.positions][w.quantity], 0.5e8);
            strictEqual(json[w.positions][w.price], 0.05e8);
            strictEqual(-1 <= json[w.free] && json[w.free] <= 0, true);
        },
        (json) => {
            strictEqual(json[w.order] !== undefined, true);
            strictEqual(json[w.order][w.symbol], "BTC");
            const temp = json[w.order][w.fee];
            messages[25][w.free] = 1e8 - parseInt(temp);
            strictEqual(["0", "1"].includes(temp), true);
        },
        {[w.symbol]: "ETH", [w.positions]: null},
        {[w.free]: 1e8, [w.locked]: 0, [w.margin]: 0},
        (json) => {
            strictEqual(json[w.order] !== undefined, true);
            strictEqual(json[w.order][w.symbol], "ETH");
            strictEqual(json[w.order][w.status], w.filled);
        },
        (json) => {
            strictEqual(json[w.symbol], "BTC");
            strictEqual(json[w.positions], null);
            strictEqual(1e8 - 5 <= json[w.free] && json[w.free] <= 1e8, true);
        },
        (json) => {
            strictEqual(json[w.order] !== undefined, true);
            strictEqual(json[w.order][w.symbol], "BTC");
            strictEqual(json[w.order][w.fee] >= 0 && json[w.order][w.fee] <= 5, true);
        },
        {[w.fundingFree]: 0, [w.fundingLocked]: 1e8},
        (json) => {
            strictEqual(json[w.order] !== undefined, true);
            strictEqual(json[w.order][w.symbol], "BTC");
            strictEqual(json[w.order][w.action], w.sell);
        },
        {[w.fundingFree]: 0, [w.fundingLocked]: 1e8},
        (json) => {
            strictEqual(json[w.order] !== undefined, true);
            strictEqual(json[w.order][w.symbol], "BTC");
            strictEqual(json[w.order][w.status], w.opened);
            strictEqual(json[w.order][w.fill], "" + 0.5e8);
        },
        {[w.fundingFree]: 0, [w.fundingLocked]: 1e8},
        (json) => {
            strictEqual(json[w.order] !== undefined, true);
            strictEqual(json[w.order][w.symbol], "BTC");
            strictEqual(json[w.order][w.status], w.filled);
            strictEqual(json[w.order][w.fill], "" + 1e8);
        },
        {[w.fundingFree]: 0.5e8, [w.fundingLocked]: 0.5e8},
        (json) => {
            strictEqual(json[w.order] !== undefined, true);
            strictEqual(json[w.order][w.counterPart], "" + 0.5e8);
            strictEqual(json[w.order][w.fee] < 0, true);
            process.exit(0);
        },
    ];

    ws['on']('open', async function () {

        await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session);
        await order({q: 1e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, await createUser([w.free, 1e8]));
        await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, await createUser([w.free, 1e8]));
        await order({q: 1e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session);
        await order({q: 1e8, p: 0.05e8, s: 'BTC', a: 's', e: w.GTC}, await createUser([w.fundingFree, 1e8]));
        await order({q: 2e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session);
        await order({q: 2e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, await createUser([w.free, 2e8]));
        await order({q: 0.5e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session);
        await order({q: 0.5e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, await createUser([w.free, 2e8]));
        await order({q: 1.5e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, await createUser([w.free, 2e8]));
        await order({q: 1.5e8, p: 1e8, s: 'ETH', a: 's', e: w.GTC}, session);


        await order({q: 1e8, p: 0.05e8, s: 'BTC', a: 's', e: w.GTC}, session);
        [session, user] = await createUser([w.free, 0.5e8]);
        await order({q: 1e8, p: 1e8, s: 'GOLD', a: 'b', e: w.GTC}, session);
        await order({q: 1e8, p: 1e8, s: 'GOLD', a: 's', e: w.GTC}, await createUser([w.free, 0.5e8]));
        await order({q: 1e8, p: 1e8, s: 'GOLD', a: 's', e: w.GTC}, session);
        await wait(1000);
        await order({q: 1e8, p: 1e8, s: 'GOLD', a: 'b', e: w.GTC}, await createUser([w.free, 1e8]));
    });

    let i = -1;

    ws['on']('message', async function (data) {
        if (data.toString() === JSON.stringify({"hb": 1})) return;
        i++;
        if (typeof messages[i] === "function") {
            messages[i](JSON.parse(data.toString()));
        } else if (messages[i]) {
            strictEqual(JSON.stringify(messages[i]), data.toString(), data.toString() + " " + i);
        } else if (i) {
            strictEqual(true, false, data.toString() + " " + i);
        }
    });
})();