const w = require('../words');
const co = require('../constants');
const {publish, wait} = require("../utilities/commons");

(async function () {
    for (let i in co.machines) {
        if (typeof co.redisClusters[i] === w.string) continue;
        publish({[w.loadFiles]: true}, i);
    }
    await wait(3000);
    process.exit(0);
})();