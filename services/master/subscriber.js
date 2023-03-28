const Redis = require('redis'),
    w = require('../../words'),
    co = require('../../constants'),
    {communicate} = require("../../utilities/communicator"),
    workers = require('./workers');

for (let c in co.redisClusters) {
    if (!c.startsWith(w.minus) || typeof co.redisClusters[c] === w.string) continue;

    const client = Redis.createClient(co.redisClusters[c]);

    client.on('error', function (err) {
    });

    client.on('connect', async function () {
        await client.subscribe(w.events);
    });

    client.on('unsubscribe', async function (channel) {
        await client.subscribe(channel);
    });

    client.on('message', function (channel, json) {
        try {
            const msg = JSON.parse(json);
            for (let i in workers) workers[i].send(msg);
            communicate(msg);
        } catch (e) {
        }
    });

}