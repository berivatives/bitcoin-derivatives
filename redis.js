const Redis = require('redis'),
    bluebird = require('bluebird'),
    w = require('./words'),
    co = require('./constants'),
    clients = {};

bluebird['promisifyAll'](Redis);

for (let c in co.redisClusters) {
    if (typeof co.redisClusters[c] === w.string) {
        clients[c] = clients[co.redisClusters[c]];
        continue;
    }

    clients[c] = Redis.createClient(co.redisClusters[c]);

    clients[c].on('ready', async function () {
        clients[c].enable_offline_queue = false;
    });

    clients[c].on('error', function (err) {
    });
}

module.exports = clients;
