const {strictEqual} = require('assert');
const w = require('../words');
const {httpGet, query} = require("./utilities");
const mongo = require("../mongo");
const {clearCache} = require("./clearCache");
const {getCluster} = require("../utilities/commons");

let error, data;

(async () => {
    await clearCache();
    ({error, data} = await httpGet('/error' + query({})));
    strictEqual(error, true);
    strictEqual(data, w.IMPOSSIBLE_OPERATION);
    const stack = "" + Date.now();
    ({error} = await httpGet('/error' + query({error, stack})));
    strictEqual(error, false);
    ({error, data} = await httpGet('/error' + query({error, stack})));
    strictEqual(error, true);
    strictEqual(data, w.PLEASE_DO_NOT_HURT_ME);
    strictEqual((await mongo[getCluster(w.error)].collection(w.error).find({stack}).toArray()).length, 1);
    process.exit(0);
})();