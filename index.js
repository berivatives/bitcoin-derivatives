const cluster = require('cluster'),
    path = require('path'),
    os = require('os'),
    {strictEqual} = require('assert'),
    querystring = require('querystring'),
    uws = require('uWebSockets.js'),
    co = require("./constants"),
    w = require("./words"),
    cors = require('./utilities/cors');

process.on('uncaughtException', function (err) {
    console.log('uncaughtException', err);
});

function init(isMaster) {
    const interfaces = os.networkInterfaces();
    Object.keys(interfaces).forEach(function (name) {
        let alias = 0;
        interfaces[name].forEach(function (interfac) {
            if ('IPv4' !== interfac.family || interfac.internal !== false) return;
            if (!alias) {
                if (co.isDev) interfac.address = co.localHost;
                co.machines.forEach((machine, i) => {
                    !co[w.cluster] && machine.forEach((ip, machineIndex) => {
                        if (!co[w.cluster] && ip === interfac.address) {
                            co[w.ip] = ip;
                            co[w.cluster] = co.clusters[i];
                            co[w.index] = machineIndex;
                        }
                    });
                });
                if (isMaster) start();
            }
            ++alias;
        });
    });

    strictEqual(co[w.cluster] !== undefined, true);

    if (!isMaster && !isNaN(parseInt(co[w.reboot]))) {
        setTimeout(() => {
            co[w.maintenance] = true;
            setTimeout(() => process.exit(0), 10000);
        }, co[w.reboot] * 1000)
    }
}

if (cluster.isMaster) {

    function start() {
        const workers = require('./services/master/workers');
        require('./services/master/subscriber');

        // start only on the first machine of the cluster
        if (!co[w.index]) {
            require('./services/master/eventsQueue');
            require('./services/master/deposits');
            require('./services/master/interests');
        }

        function createWorker() {
            const worker = cluster.fork();
            workers[worker.process.pid] = worker;
        }

        for (let i = 0; i < os.cpus().length && i < 4; i++) createWorker();

        cluster.on("exit", (deadWorker) => {
            const {pid, exitCode} = deadWorker.process;
            exitCode && console.log(`worker ${pid} died`, new Date());
            delete workers[pid];
            if (!co.isDev) {
                setTimeout(function () {
                    createWorker();
                }, 1000);
            }
        });
    }

    init(true);

} else {

    init();

    const router = require('./router'),
        api = require('./services/account/api'),
        {isConnectedAsync} = require('./utilities/checkClient'),
        {getIp} = require("./utilities/commons"),
        {communicate} = require("./utilities/communicator"),
        download = require("./utilities/download"),
        WebSocketMarket = require('./WebSocketMarket'),
        WebSocketAccount = require('./WebSocketAccount');

    process.on('message', function (msg) {
        communicate(msg);
    });

    function sendFile(res, fileName) {
        if (!router[w.files][fileName]) {
            const file = router[w.files]["404.html"];
            res.writeStatus('404 Not Found').end(co.cache ? file : file());
        } else {
            res.writeStatus('200 OK').writeHeader("Content-Type", co[w.extensions][path.extname(fileName)]);
            download(res, co.cache ? router[w.files][fileName] : router[w.files][fileName]());
        }
    }

    router[w.noUserCheck]['admin'] = true;
    router[w.noUserCheck]['unstable'] = true;

    router["admin"] = (id, c, json, callback, args) => {
        sendFile(args.res, "index.html");
    };

    router["unstable"] = (id, c, json, callback, args) => {
        sendFile(args.res, "unstable.html");
    };

    const maxPayloadLength = 512;

    uws['App']().ws('/markets', {
        maxPayloadLength,
        open: (ws) => {
            WebSocketMarket.open(ws);
        },
        message: (ws, message) => {
            // noinspection JSIgnoredPromiseFromCall
            WebSocketMarket.message(ws, Buffer.from(message).toString());
        },
        close: (ws) => {
            WebSocketMarket.close(ws);
        }
    }).ws('/account', {
        maxPayloadLength,
        upgrade: async (res, req, context) => {
            res.onAborted(() => {
                res.aborted = true;
            });
            const key = req.getHeader('sec-websocket-key');
            const protocol = req.getHeader('sec-websocket-protocol');
            const extensions = req.getHeader('sec-websocket-extensions');
            req.cookie = req.getHeader('cookie');
            req.query = req.getQuery();
            const session = await getUser(req, res, querystring.parse(req['query']));
            if (!session || !session[w.id]) return res.close();
            session[w.ip] = getIp(res);
            res.upgrade(
                {session, key, queue: !req['query'].includes('noQueue')},
                key,
                protocol,
                extensions,
                context
            );
        },
        open: (ws) => {
            // noinspection JSIgnoredPromiseFromCall
            WebSocketAccount.open(ws);
        },
        message: (ws, message) => {
            // noinspection JSIgnoredPromiseFromCall
            WebSocketAccount.message(ws, Buffer.from(message).toString());
        },
        close: (ws) => {
            WebSocketAccount.close(ws);
        }
    }).any('/*', async (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        const method = req.getMethod().toLowerCase(),
            url = req.getUrl().substring(1),
            query = querystring.parse(req.getQuery()),
            origin = req.getHeader('origin');

        req.country = req.getHeader('cf-ipcountry');
        req.cookie = req.getHeader('cookie');
        req.ip = req.getHeader('cf-connecting-ip');

        if (method === 'options') {
            answer(req, res, origin, false);
        } else if (url === 'upload' && method === 'post') {
            const buffer = [];
            let byteLength = 0;
            res.onData((chunk, isLast) => {
                byteLength += chunk.byteLength;
                if (byteLength < co.maxSize) buffer.push(new Uint8Array(chunk.slice(0)));
                else return res.close();
                if (isLast) handleRequest(req, res, method, w.verification, origin, {buffer, ...query});
            });
            res.onAborted(() => {
                res.aborted = true;
                answer(req, res, origin, true, w.UNKNOWN_ERROR);
            });
        } else if (method === 'post' || method === 'put') {
            readJson(res, async (obj) => {
                await handleRequest(req, res, method, url, origin, {...obj, ...query});
            }, () => {
            });
        } else {
            if (!router[url]) {
                sendFile(res, path.basename(req.getUrl()).split('?')[0] || (co[w.maintenance] ? "maintenance.html" : "index.html"));
            } else {
                await handleRequest(req, res, method, url, origin, query);
            }
        }
    }).listen(8000, (listenSocket) => {
        if (!listenSocket) {
            console.log("failed to listenSocket");
            process.exit(0);
        }
    });

    async function getUser(req, res, body) {
        if (co[w.maintenance]) return {};
        const {session, key, message, time} = body;
        if (session) return isConnectedAsync("session=" + session);
        else if (!req.cookie && key) return await api.verify(key, message, time, getIp(res));
        else return isConnectedAsync(req.cookie);
    }

    async function handleRequest(req, res, method, url, origin, body) {
        try {
            const user = !router[w.noUserCheck][url] ? (await getUser(req, res, body)) : {};
            if (!router[w.noUserCheck][url] && (!user || !user[w.id])) {
                return answer(req, res, origin, true, (co[w.maintenance] ? w.MAINTENANCE : w.UNAUTHORIZED_OPERATION));
            }
            router[url](
                user[w.id], user[w.cluster], body, function (error, data) {
                    answer(req, res, origin, error, data);
                }, {req, res, url, [w.ip]: req.ip || getIp(res), origin}
            ).catch((e) => {
                if (!w[e]) console.log(e);
                answer(req, res, origin, true, w[e] || w.UNKNOWN_ERROR);
            });
        } catch (e) {

        }
    }
}

const answer = function (req, res, origin, error, data) {
    try {
        if (res[w.headerWritten] !== true) {
            res.writeStatus('200 OK');
            res.writeHeader("Content-Type", "application/json");
            const headers = {...(res[w.headerWritten] || {}), ...cors(origin)};
            for (let i in headers) res.writeHeader(i, "" + headers[i]);
        }
        if (!res.aborted) {
            if (error !== undefined) res.end(JSON.stringify({error, data}));
            else res.end();
        }
    } catch (e) {

    }
};

function readJson(res, cb, err) {
    let buffer;
    res.onData((ab, isLast) => {
        let chunk = Buffer.from(ab);
        if (isLast) {
            try {
                cb(JSON.parse("" + (buffer ? Buffer.concat([buffer, chunk]) : chunk)));
            } catch (e) {
                res.close();
            }
        } else {
            buffer = Buffer.concat(buffer ? [buffer, chunk] : [chunk]);
        }
    });
    res.onAborted(err);
}
