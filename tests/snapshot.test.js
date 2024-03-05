const {strictEqual} = require('assert');
const w = require('../words');
const co = require('../constants');
const {clearCache} = require("./clearCache");
const {order, createUser} = require("./utilities");
const redis = require("../redis");
const {httpGet, query} = require("./utilities");

let session, user;

(async () => {

    /****add 50 orders then cancel them, open websocket and see if 25 in co and the rest completely deleted****/
    await clearCache();
    const orders = [];
    [session, user] = await createUser([w.free, 100e8, w.counter + w.order, co.maxOrders - 49]);
    for (let i = 0; i < 50; i++) {
        orders.push(await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session));
    }
    for (let i in orders) {
        strictEqual((await httpGet("/c" + query({id: orders[i].data.id}), session)).error, false);
    }

    const {error, data} = await order({q: 1e8, p: 1e8, s: 'ETH', a: 'b', e: w.GTC}, session);
    strictEqual(error, true);
    strictEqual(data, w.DAILY_LIMIT_REACHED);

    const WebSocket = require('ws');
    const ws = new WebSocket('ws://localhost:8000/account?session=' + session);

    ws['on']('message', async function (data) {
        const json = JSON.parse(data);
        if (json.t === 's') {
            strictEqual(json['co'].length, 21);
            strictEqual(await redis[user[0]].llenAsync(user + w.closedOrders), 21);
            let cpt = 0;
            for (let i in orders) {
                if (!await redis[user[0]].hgetallAsync(user + orders[i].data.id)) cpt++;
            }
            strictEqual(cpt, 29);
            process.exit(0);
        }
    });
    /****add 30 orders, open websocket and see if 25 in co and the rest completely deleted****/

})();