const {ObjectId} = require('mongodb'),
    mongo = require('../../mongo'),
    redis = require('../../redis'),
    router = require('../../router'),
    w = require('../../words'),
    {getCluster} = require('../../utilities/commons'),
    {genRandomString, securedPassword, verifyPassword, saltHashPassword} = require("../../utilities/hash"),
    {takeLockAsync} = require("../../utilities/lock");

router[w.noUserCheck]['r-' + w.password] = true;
router[w.noUserCheck]['f-' + w.password] = true;

router['r-' + w.password] = async (id, c, json, callback) => {
    const {token, key, password} = json;
    if (!token) throw w.BAD_TOKEN;
    securedPassword(password);
    const user = JSON.parse(await redis[w.minus + token[0]][w.getAsync](w.password + token));
    if (!user) throw w.BAD_TOKEN;
    id = user[w.id];
    c = user[w.cluster];
    if (user[w.key] !== key) throw w.IMPOSSIBLE_OPERATION;
    await mongo[c].collection(w.users).updateOne({[w.mongoId]: ObjectId(id)}, {
        $set: {
            ...saltHashPassword(password)
        }
    });
    redis[w.minus + c][w.del](w.password + token);
    callback(false, false);
};

router['f-' + w.password] = async (id, c, json, callback, args) => {
    await takeLockAsync(getCluster(args.ip));
    const {email} = json;
    if (!email) throw w.UNKNOWN_ACCOUNT;
    c = getCluster(email);
    const user = await mongo[c].collection(w.users).findOne({email});
    if (!user) throw w.UNKNOWN_ACCOUNT;
    const token = c + genRandomString(32), key = genRandomString(10);
    await redis[w.minus + c][w.setAsync](w.password + token, JSON.stringify({id: user[w.mongoId], c, key}));
    await redis[w.minus + c][w.lpushAsync](w.email, JSON.stringify({
        to: email, subject: "Reset password", pgp: user.pgp,
        html: '<p>Hello,<br/> your token to reset your password is:<b>' + token + '</b></p>'
    }));
    callback(false, key);
};

router[w.password] = async (id, c, json, callback) => {
    const {former, password} = json;
    securedPassword(password);
    await takeLockAsync(c + id + w.password);
    const user = await mongo[c].collection(w.users).findOne({[w.mongoId]: ObjectId(id)});
    if (!user) throw w.UNKNOWN_ERROR;
    if (!verifyPassword(user['passwordHash'], former, user.salt)) throw w.INVALID_PASSWORD;
    await mongo[c].collection(w.users).updateOne({_id: ObjectId(id)}, {
        $set: {
            ...saltHashPassword(password)
        }
    });
    callback(false, w.PASSWORD_UPDATED);
};
