const {strictEqual} = require('assert');
const w = require('../words');
const {extractField} = require("../services/trading/utilities");

function reg(e) {
    return new RegExp(e, 'g');
}

function test(error, args) {
    assert.throws(() => {
        extractField(...args);
    }, reg(error));
}

const MAX_VALUE = Number.MAX_VALUE;

test(w.UNKNOWN_EXECUTION_TYPE, [{}]);
test(w.BAD_QUANTITY, [{[w.execution]: w.GTC}]);
test(w.BAD_PRICE, [{[w.execution]: w.GTC, [w.quantity]: 1}]);
test(w.IMPOSSIBLE_OPERATION, [{[w.execution]: w.MKT, [w.quantity]: 1, [w.price]: 1}, true, 'BTC']);
test(w.IMPOSSIBLE_OPERATION, [{[w.execution]: w.MKT, [w.quantity]: 1, [w.price]: 1, [w.oco]: 1}, true, 'BTC']);
test(w.IMPOSSIBLE_OPERATION, [{[w.execution]: w.MKT, [w.quantity]: 1, [w.price]: 1, [w.oco]: 1}, true, 'ETH']);
test(w.AUTO_TRIGGER_STOP_ORDER, [{[w.execution]: w.GTC, [w.quantity]: 1, [w.price]: 1, [w.oco]: 1}, true, 'ETH']);
test(w.AUTO_TRIGGER_STOP_ORDER, [{[w.execution]: w.GTC, [w.quantity]: 1, [w.price]: 1, [w.oco]: 1}, true, 'ETH']);
test(w.MAX_6_PERCENT_A_DAY, [{[w.execution]: w.GTC, [w.quantity]: 1, [w.price]: 1e8}, true, 'BTC']);
test(w.BAD_PRICE, [{[w.execution]: w.GTC, [w.quantity]: 1, [w.price]: Infinity}, true, 'ETH']);
test(w.BAD_PRICE, [{[w.execution]: w.GTC, [w.quantity]: 1, [w.price]: MAX_VALUE}, true, 'ETH']);
test(w.BAD_PRICE, [{[w.execution]: w.GTC, [w.quantity]: MAX_VALUE, [w.price]: MAX_VALUE}, true, 'ETH']);
test(w.BAD_PRICE, [{[w.execution]: w.GTC, [w.quantity]: MAX_VALUE / 2, [w.price]: 100e8}, true, 'ETH']);
test(w.OUT_OF_RANGE, [{[w.execution]: w.GTC, [w.quantity]: MAX_VALUE / 2, [w.price]: 100e8 - 1}, true, 'ETH']);

process.exit(0);