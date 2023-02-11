const w = require('../words'),
    {publish} = require("../utilities/commons");

publish({[w.maintenance]: process.argv[2] === undefined}, 0);

setTimeout(function () {
    process.exit(0);
}, 5000);