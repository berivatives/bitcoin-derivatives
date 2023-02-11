const http = require('http'),
    crypto = require("crypto"),
    {strictEqual} = require('assert'),
    querystring = require('querystring'),
    w = require("../words"),
    redis = require("../redis"),
    mongo = require("../mongo"),
    {wait, getCluster} = require("../utilities/commons"),
    {genRandomString} = require("../utilities/hash");

const httpRequest = function (path, session, dontParse, headers, body, hostname) {
    return new Promise(function (resolve, reject) {
        const req = http.request({
            hostname: hostname || 'localhost',
            port: 8000,
            method: body ? 'POST' : 'GET',
            headers: headers ? headers : !session ? {} : {
                Cookie: "session=" + session
            },
            path
        }, (res) => {
            let data = "";
            res.on('data', function (body) {
                data += body;
            });
            res.on('end', async function () {
                if (dontParse) return resolve(data);
                resolve(JSON.parse(data));
            });
        }).on('error', () => {
            reject();
        });
        if (body) req.write(body);
        req.end();
    });
};

exports.httpGet = function (path, session, dontParse, headers, hostname) {
    return httpRequest(path, session, dontParse, headers, null, hostname);
};

exports.httpPost = function (path, session, dontParse, headers, body) {
    return httpRequest(path, session, dontParse, headers, body);
};

const query = function (json, useKey) {
    if (useKey) {
        const time = String(Date.now());
        const message = crypto.createHmac("sha512", json["secret"]).update(time).digest("hex");
        if (!json["key"]) json["key"] = "0key";
        json["time"] = time;
        json["message"] = message;
        delete json['secret'];
    }
    return "?" + querystring.stringify(json);
};

exports.query = query;

exports.order = async function (json, s) {
    return httpRequest('/o' + query(json), typeof s === "string" ? s : s[0]);
};

exports.createUser = async function (command, users, ts, customId, customCluster) {
    const id = String(customId || (!ts && users ? users.length : Date.now()));
    const c = customId ? customCluster : getCluster(id);
    const session = c + genRandomString(128);
    redis[w.minus + c].set("session" + session, customId ? id : (c + id));
    if (command) await redis[c].hmsetAsync(customId ? id : (c + id), ...command);
    await wait(10);
    if (users) users.push([session, c + id, c]);
    return [session, customId ? id : (c + id), c];
};

exports.checkBalance = async function (id, ...fields) {
    for (let i = 0; i < fields.length; i += 2) strictEqual(await getProp(id, fields[i]), fields[i + 1], fields[i]);
};

exports.checkPos = async function (id, symbol, pos) {
    strictEqual(await redis[id[0]].hgetAsync(id, w.positions + symbol), pos === null ? null : JSON.stringify(pos));
};

exports.orderBookSize = async function (s, size) {
    strictEqual(await redis[0].zcardAsync(s), size);
};

exports.openOrdersSize = async function (id, size) {
    strictEqual(await redis[id[0]].scardAsync(id + w.openOrders), size);
};

exports.BTCSize = async function (id, size) {
    strictEqual(await redis[id[0]].llenAsync(id + w.borrowed), size);
};

exports.closedOrdersSize = async function (id, size) {
    strictEqual(await redis[id[0]].llenAsync(id + w.closedOrders), size);
};

exports.checkOrdersMongo = async function (id, size) {
    await wait(100);
    strictEqual((await mongo[id[0]].collection(w.orders + getCluster(id)).find({id}).toArray()).length, size);
};

exports.checkDuplicates = async function (id) {
    const o = await redis[id[0]].lrangeAsync(id + w.closedOrders, 0, -1);
    strictEqual(new Set(o).size, o.length, o);
};

const getProp = async function (id, prop, str, c) {
    const res = await redis[c || id[0]].hgetAsync(id, prop);
    return str ? res : res * 1;
};

exports.getProp = getProp;

exports.clearIPLock = async function () {
    await clearLock("127.0.0.1", getCluster("127.0.0.1"));
};

const clearLock = async function (lock, c) {
    await redis[w.minus + (c || lock[0])][w.delAsync]((c || "0") + lock + w.lock);
};

exports.clearLock = clearLock;