const net = require('net'),
    redis = require('../../redis'),
    w = require('../../words'),
    co = require('../../constants'),
    matching = require('../trading/matching'),
    cancel = require('../trading/cancel'),
    clients = {};

const server = new net.Server().listen(8001);

server.on('connection', async function (socket) {
    let id;

    socket.on('data', async function (data) {
        if (!id) {
            id = data.toString();
            clients[id] = socket;
        }
    });

    socket.on('close', function () {
        if (clients[id]) delete clients[id];
    });

    socket.on('error', function () {
        if (clients[id]) delete clients[id];
    });
});

server.on('err', async function (error) {
    console.log(error)
});

const actions = {
    [w.open]: async (params) => await matching(params),
    [w.cancel]: async (params) => await cancel(params),
    [w.replace]: async (params) => await cancel(params),
};

redis[0][w.smembers](w.tickers, async function (err, symbols) {
    for (let i in symbols) {
        const {s, c} = JSON.parse(symbols[i]);
        if (co[w.cluster] === "" + c && co[w.ip] === co.machines[c][0]) {
            // noinspection ES6MissingAwait
            initEventsQueue(s, c);
        }
    }
});

const initEventsQueue = async (s, c) => {

    const client = redis[w.minus + c].duplicate();

    client.on('error', function (err) {
    });

    // noinspection InfiniteLoopJS
    while (true) {
        let params;
        try {
            params = JSON.parse((await client[w.brpopAsync](s + w.orderBook, 0))[1]);
            answer(params, await actions[params[params.length - 1]](params));
        } catch (e) {
            if (w[e]) {
                try {
                    answer(params, {error: true, data: e})
                } catch (e) {

                }
            } else {
                console.log(e);
            }
        }
    }
};

function answer(params, {error, data}) {
    clients[params[params.length - 2]] &&
    clients[params[params.length - 2]].write(JSON.stringify({id: params[0] + params[2], error, data}) + "|");
}

exports.initEventsQueue = initEventsQueue;
