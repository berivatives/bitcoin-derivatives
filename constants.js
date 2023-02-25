const fs = require('fs'),
    {strictEqual} = require('assert'),
    secret = __dirname + "/secrets.json",
    map = {};

map.__dirname = __dirname;
map.isDev = !fs.existsSync(secret);
map.satoshi = 1e8;
map.maxLeverage = 10;
map.maxPrice = Math.pow(map.satoshi, 2);
map.feesMaker = -0.04 / 100;
map.feesTaker = 0.05 / 100;
map.minimalFundingSAT = 0.005 * map.satoshi;
map.minimalOrderSAT = 0.00005 * map.satoshi;
map.minimalWithdrawSAT = 0.00025 * map.satoshi;
map.maxOrders = 10000;
map.clusters = '0123456789';

// local dev hot wallet
map.bitcoinIP = "127.0.0.1";
map.bitcoinPort = "8332";
map.bitcoinUser = "dev";
map.bitcoinPassword = "dev";
map.confirmations = 6;

map.dbName = "exchange";

map.localHost = "127.0.0.1";
map.machines = [
    [map.localHost, map.localHost, map.localHost],
    // ["172.16.191.130", "172.16.191.130", "172.16.191.130"],
];

map.mongoRs = false;

map.uploadPassword = "dev";
map.maxSize = 1024 * 1024 * 10;
map.maxDailyWithdraw = 1e8;

if (!map.isDev) {
    const secrets = JSON.parse("" + fs.readFileSync(secret));
    ['redisPassword', 'bitcoinPassword', 'uploadPassword'].forEach(p =>
        strictEqual(secrets[p] !== undefined, true)
    );
    for (let i in secrets) map[i] = secrets[i];
}

map.mongoClusters = [];
map.redisClusters = {};
map.realClusters = {};

let rotate = 0, realCluster;
for (let i in map.clusters) {

    const machines = map.machines[i], c = map.clusters[i];

    if (machines) {
        map.realClusters[i] = c;
        strictEqual(machines.length === 3, true);
    } else {
        if (rotate === map.machines.length) rotate = 0;
        realCluster = "" + rotate;
        map.realClusters[i] = realCluster;
        rotate++;
    }

    if (map.mongoRs) {
        if (map.isDev) map.mongoClusters.push(machines ? "mongodb://127.0.0.1:27020,127.0.0.1:27021,127.0.0.1:27022/?replicaSet=rs&w=majority&readPreference=secondary" : realCluster);
        else map.mongoClusters.push(machines ? "mongodb://" + machines.join(":27017,") + ":27017/?replicaSet=rs&w=majority&readPreference=secondary" : realCluster);
    } else {
        map.mongoClusters.push(machines ? "mongodb://" + machines[0] + ":27017" : realCluster);
    }

    ["", "-", "+"].forEach((cl, y) => {
        map.redisClusters[cl + c] = machines ? {
            host: machines[y],
            port: (6379 + y),
            password: map.isDev ? undefined : map['redisPassword'],
            enable_offline_queue: true,
            retry_unfulfilled_commands: false
        } : cl + realCluster;
    });

}

map.extensions = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".csv": "text/csv",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".gif": "image/gif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ttf": "font/font-sfnt",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".cur": "image/x-icon",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".json": "application/json",
    ".pdf": "application/pdf",
};

module.exports = map;
