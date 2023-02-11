const {strictEqual} = require('assert');
const w = require('../words');
const co = require('../constants');
const {clearCache} = require("./clearCache");
const {order, createUser} = require("./utilities");
const redis = require("../redis");
const {roundTo} = require("../utilities/commons");
const {BTCSize} = require("./utilities");
const {checkBalance} = require("./utilities");
const {checkPos} = require("./utilities");
const {clearLock} = require("./utilities");
const {getProp, httpGet, query, orderBookSize, openOrdersSize} = require("./utilities");
const {wait} = require("../utilities/commons");

let error, data, session, user, session2, user2, orders = [];

(async () => {

    process.exit(0);
})();