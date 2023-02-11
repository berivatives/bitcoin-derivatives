const {strictEqual} = require('assert');
const w = require('../words');
const {createUser} = require("./utilities");
const {osCommand, wait} = require("../utilities/commons");
const {clearCache} = require("./clearCache");
const {order} = require("./utilities");

let error, data;

(async () => {
    await clearCache();
    const s = "" + Date.now();
    const [session] = await createUser([w.free, 1e8]);
    ({data, error} = await order({q: 1e8, p: 1e8, s, a: 's', e: 'GTC'}, session));
    strictEqual(error, true);
    strictEqual(data, w.IMPOSSIBLE_OPERATION);
    await osCommand("node", [__dirname.replace("tests", "scripts") + "/addMarket.js", s, s, "0"]);
    await wait(2000);
    ({data, error} = await order({q: 1e8, p: 1e8, s, a: 's', e: 'GTC'}, session));
    strictEqual(error, false);
    process.exit(0);
})();