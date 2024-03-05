const {strictEqual} = require('assert');
const w = require('../words');
const {createUser} = require("./utilities");
const {httpGet, query} = require("./utilities");

(async () => {
    let error, data;

    ({error, data} = await httpGet('/signup', null, false, {'cf-ipcountry': 'US'}));
    strictEqual(error, true);
    strictEqual(data, w.IMPOSSIBLE_OPERATION);

    ({error, data} = await httpGet('/connected', null, false, {'cf-ipcountry': 'US'}));
    strictEqual(error, true);
    strictEqual(data, w.IMPOSSIBLE_OPERATION);

    const email = Date.now() + "@mail.com", password = "rgezfgnbezgloergezer98479za4é";
    ({error} = await httpGet('/signup' + query({email, password})));
    strictEqual(error, false);
    ({error, data} = await httpGet('/administration', data));
    strictEqual(error, true);
    strictEqual(data, w.UNAUTHORIZED_OPERATION);

    const [session] = await createUser([w.free, 0], null, null, "6378de9712479b1c5a3e2874", "3");
    ({error, data} = await httpGet('/administration', session));
    strictEqual(error, true);
    strictEqual(data, w.IMPOSSIBLE_OPERATION);

    for (const a of [w.users, w.withdrawLogs, w.addresses, w.verification, w.deposits]) {
        ({error, data} = await httpGet('/administration' + query({a, page: 1, items: 20}), session));
        strictEqual(error, false);
        strictEqual(Array.isArray(data.documents), true);
    }

    process.exit(0);
})();
