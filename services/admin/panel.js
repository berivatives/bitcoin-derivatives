const {ObjectId} = require('mongodb'),
    redis = require('../../redis'),
    mongo = require('../../mongo'),
    router = require('../../router'),
    w = require('../../words'),
    co = require('../../constants'),
    {exportFile, webEvent, getCluster} = require("../../utilities/commons"),
    {genRandomString} = require("../../utilities/hash");

const admin = [
    "6378de9712479b1c5a3e2874",
    "637f3b1bfc36fc059ad473a4",
    "637cff7981ed2c2d066bf436",
    "637fda0cac026110e4963af0",
    "640261427873cc26a1a8e79b",
];

router[w.admin] = async (id, c, json, callback, args) => {
    if (!admin.includes(id)) throw w.UNAUTHORIZED_OPERATION;

    if (json[w.action] === "getUser") {
        await getUser(json, callback);
    } else if (json[w.action] === "getFile") {
        await getFile(json, callback, args);
    } else if (json[w.action] === "login") {
        await login(json, callback, args);
    } else if (json[w.action] === "verifyFile") {
        await verifyFile(json, callback, args);
    } else if (json[w.action] === "verifyAccount") {
        await verifyAccount(json, callback, args);
    } else if ([w.users, w.withdrawLogs, w.addresses, w.verification, w.deposits, w.error].includes(json[w.action])) {
        await getDocuments(json, json[w.action], callback);
    } else {
        throw w.IMPOSSIBLE_OPERATION;
    }
};

async function getDocuments(json, collection, callback) {
    let {page, items, c, filter} = json;
    let count = 0;
    const documents = [];
    const cursor = await mongo[c || 0].collection(collection).find(filter);
    count += await cursor.count();
    await iterate(c || 0, cursor, documents, page, items);
    callback(false, {count, documents})
}

function iterate(c, cursor, documents, page, items) {
    return new Promise((resolve, reject) => {
        cursor.sort({[w.mongoId]: -1}).skip((page - 1) * items).limit(items * 1).forEach((doc) => {
            if (doc) {
                doc[w.timestamp] = ObjectId(doc[w.mongoId])['getTimestamp']();
                doc[w.cluster + w.id] = getCluster(doc[w.mongoId]);
                documents.push(doc);
            }
        }, (err) => {
            if (err) reject();
            else resolve();
        });
    })
}

async function getUser(json, callback) {
    const {id, c} = json;
    const user = await mongo[c || 0].collection(w.users).findOne({[w.mongoId]: ObjectId(id)});
    if (!user) throw w.UNKNOWN_ACCOUNT;
    callback(false, {
        ...user,
        ...await redis[c].hgetallAsync(user[w.mongoId] + w.map),
        ...await redis[c].hgetallAsync("" + user[w.mongoId])
    });
}

async function login(json, callback, args) {
    const {id, c} = json;
    const user = await mongo[c || 0].collection(w.users).findOne({[w.mongoId]: ObjectId(id)});
    if (!user) throw w.UNKNOWN_ACCOUNT;
    const session = c + genRandomString(128);
    await redis[w.minus + c].setAsync("session" + session, id);
    args.res[w.headerWritten] = {
        "Refresh": "0; url=" + (!co.isDev ? "/" : "http://localhost:3000") + "?email=" + user[w.email] + "&session=" + session
    };
    callback(false);
}

async function getFile(json, callback, args) {
    const {f, id, c} = json;
    const file = await mongo[c || 0].collection(w.verification).findOne({id});
    if (!file) throw w.IMPOSSIBLE_OPERATION;
    exportFile(args.req, args.res, f, file[w.verification][f][0], args.origin, callback);
}

async function verifyAccount(json, callback) {
    const {id, c} = json;
    if (!await mongo[c || 0].collection(w.users).findOne({[w.mongoId]: ObjectId(id)})) throw w.UNKNOWN_ACCOUNT;
    await redis[c || 0][w.hsetAsync](id, w.verification + w.status, w.true);
    webEvent({[w.verification + w.status]: w.true}, id, c || 0);
    callback(false);
}

async function verifyFile(json, callback) {
    const {f, id, c, st, t} = json;
    const userFiles = await mongo[c || 0].collection(w.verification).findOne({id});
    if (!userFiles) throw w.UNKNOWN_ACCOUNT;
    const {ve} = userFiles;
    if (st !== true) await redis[c || 0][w.hdelAsync](id, w.verification + w.status);
    ve[f][1] = st;
    ve[f][3] = t;
    await redis[c || 0][w.hsetAsync](id + w.map, w.verification, JSON.stringify(ve));
    let validated = 0;
    for (let i in ve) {
        if (ve[i][1] === true) validated++;
    }
    await mongo[c || 0].collection(w.verification).updateOne({id}, {
        $set: {
            ve,
            [w.status]: validated === Object.keys(ve).length
        }
    });
    webEvent({ve}, id, c);
    callback(false);
}