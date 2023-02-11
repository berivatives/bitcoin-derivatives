const w = require('../../words'),
    {intervals} = require('./candle'),
    map = {};

exports.initChannels = function (s) {
    map[s] = {};
    map[s][w.historic] = {};
    map[s][w.orderBook] = {};
    for (let interval in intervals) {
        map[s][interval] = {};
    }
};

module.exports.channels = map;
