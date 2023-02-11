const fs = require('fs'),
    w = require('../../words'),
    co = require('../../constants'),
    mongo = require('../../mongo'),
    redis = require('../../redis'),
    router = require('../../router'),
    {takeLockAsync} = require("../../utilities/lock"),
    {exportFile, webEvent, osCommand} = require("../../utilities/commons"),
    {createCipheriv, genRandomBytes} = require("../../utilities/hash");

if (!fs.existsSync(co.__dirname + '/upload/')) fs.mkdirSync(co.__dirname + '/upload/');

router[w.verification] = async (id, c, json, callback, {res, ip}) => {
    const {l, buffer, t} = json;
    if (!l || !t || (t < 1 || t > 3) || !buffer.length || !(buffer[0] instanceof Uint8Array) || !res) throw w.IMPOSSIBLE_OPERATION;
    await takeLockAsync(c + id + w.verification);
    const [initVerification, subAccount] = await redis[c][w.hmgetAsync](id + w.map, w.verification, w.subAccount);
    if (subAccount) throw w.IMPOSSIBLE_OPERATION;
    const ve = JSON.parse(initVerification) || {};
    if (Object.keys(ve).length > 4) throw w.IMPOSSIBLE_OPERATION;
    const iv = genRandomBytes(16);
    const fileId = iv.toString('hex');
    const cipher = createCipheriv(iv);
    const path = co.__dirname + '/upload/' + fileId;
    const writeStream = fs.createWriteStream(path, {flags: 'w'});
    for (let i in buffer) writeStream.write(cipher.update(buffer[i]));
    writeStream.write(cipher.final());
    writeStream.close();
    ve[fileId] = [l, false, t];
    if (!initVerification) await mongo[c].collection(w.verification).insertOne({id, ve, ip, [w.status]: false});
    else await mongo[c].collection(w.verification).updateOne({id}, {$set: {ve, [w.status]: false}});
    await redis[c][w.hsetAsync](id + w.map, w.verification, JSON.stringify(ve));
    webEvent({ve}, id, c);
    co.machines[co.realClusters[c]].filter(ip => co[w.ip] !== ip).forEach(ip => osCommand("scp", [path, ip + ":" + path]));
    callback(false);
};

router['dl-' + w.verification] = async (id, c, json, callback, args) => {
    await takeLockAsync(c + id + w.verification, 5);
    const file = JSON.parse(await redis[c][w.hgetAsync](id + w.map, w.verification))[json[w.id]];
    if (!file) throw w.IMPOSSIBLE_OPERATION;
    exportFile(args.req, args.res, json[w.id], file[0], args.origin, callback);
};

router['d-' + w.verification] = async (id, c, json, callback) => {
    const ve = JSON.parse(await redis[c][w.hgetAsync](id + w.map, w.verification)) || {};
    if (ve[json[w.id]][1] === true) throw w.IMPOSSIBLE_OPERATION;
    const path = co.__dirname + '/upload/' + json[w.id];
    fs.rmSync(path);
    delete ve[json[w.id]];
    await redis[c][w.hsetAsync](id + w.map, w.verification, JSON.stringify(ve));
    await mongo[c].collection(w.verification).updateOne({id}, {$set: {ve}});
    webEvent({ve}, id, c);
    co.machines[co.realClusters[c]].filter(ip => co[w.ip] !== ip).forEach(ip => osCommand("ssh", ["-t", "-t", ip, "rm " + path]));
    callback(false);
};

