const {strictEqual} = require('assert');
const w = require('../words');
const {createUser} = require("./utilities");
const {httpGet, query} = require("./utilities");
const {wait, publish} = require("../utilities/commons");

(async () => {
    publish({[w.maintenance]: w.plus}, 0);
    await wait(1000);
    const [session] = await createUser([w.free, 0]);
    let error, data;
    ({error, data} = await httpGet('/o' + query({q: 5e8, p: 1e8, s: 'ETH', a: 's', e: 'GTC'}), session));
    strictEqual(error, true);
    strictEqual(data, w.MAINTENANCE);

    data = await httpGet('/', null, true);
    strictEqual(data.includes("<title>Maintenance</title>"), true);

    publish({[w.maintenance]: w.minus}, 0);
    await wait(1000);

    data = await httpGet('/', null, true);
    strictEqual(data.includes("<title>Maintenance</title>"), false);

    ({error, data} = await httpGet('/o' + query({q: 5e8, p: 1e8, s: 'ETH', a: 's', e: 'GTC'}), session));
    strictEqual(error, true);
    strictEqual(data, w.INSUFFICIENT_BALANCE);

    process.exit(0);
})();
