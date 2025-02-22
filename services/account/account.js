const {ObjectId} = require('mongodb'),
    speakeasy = require('speakeasy'),
    mongo = require('../../mongo'),
    redis = require('../../redis'),
    w = require('../../words'),
    co = require('../../constants'),
    router = require('../../router'),
    {getCluster, getRights, webEvent, validateEmail} = require('../../utilities/commons'),
    {getSessionCookie, isConnected} = require('../../utilities/checkClient'),
    {genRandomString, securedPassword, verifyPassword, saltHashPassword, decrypt} = require("../../utilities/hash"),
    {takeLockAsync} = require("../../utilities/lock");

router[w.noUserCheck]['connected'] = true;
router[w.noUserCheck]['signin'] = true;
router[w.noUserCheck]['signup'] = true;

const restricted = ["CU", "IR", "SY", "US"];

router['connected'] = async (id, c, json, callback, args) => {
    isRestCall(args);
    isConnected(args.req.cookie, function (result) {
        callback(false, result !== null);
    });
};

router['signup' + w.subAccount] = async (id, c, json, callback, args) => {
    await router['signup'](id, c, json, callback, args);
};

router['signup'] = async (id, c, json, callback, args) => {
    isRestCall(args);
    const {ip} = args;
    co[w.ip] !== ip && await takeLockAsync(getCluster(ip) + ip);

    let {email, password, subAccount, referral} = json;
    if (!email || !validateEmail(email) || email.length > 100) throw w.INVALID_EMAIL;
    email = email.toLowerCase();
    securedPassword(password);

    if (email === password) throw w.ARE_U_SERIOUS;
    let mainAccountCluster = c;
    c = getCluster(email);

    const doc = {
        c,
        email,
        ip,
        country: args.req.country,
        ...saltHashPassword("" + password)
    };

    if (referral) {
        const [referralId, referralCluster] = referral.split('_');
        const referralUser = await mongo[referralCluster].collection(w.users).findOne({[w.mongoId]: ObjectId(referralId)});
        if (!referralUser || !referralUser[w.referral]) throw w.UNAUTHORIZED_OPERATION;
    }

    if (subAccount && id) {
        if (await redis[mainAccountCluster][w.hgetAsync](id, w.subAccount)) throw w.UNAUTHORIZED_OPERATION;
        doc[w.subAccount] = id;
    }

    await mongo[c].collection(w.users).insertOne(doc, async function (err, result) {
        if (err) return callback(true, err.code === 11000 ? w.EMAIL_TAKEN : w.UNKNOWN_ERROR);
        try {
            doc[w.mongoId] = "" + result.insertedId;
            if (doc[w.subAccount]) {
                const subAccount = {
                    [w.id]: doc[w.mongoId],
                    [w.disabled]: json[w.disabled] === true,
                    [w.right]: getRights(json)
                };
                await redis[c][w.hsetAsync](doc[w.mongoId] + w.map, w.email, email, w.subAccount, id);
                await redis[c][w.hsetAsync](doc[w.mongoId], w.email, email, w.subAccount, id, w.subAccount + w.cluster, mainAccountCluster, w.right, JSON.stringify(subAccount[w.right]));
                await redis[mainAccountCluster][w.hsetAsync](id + w.subAccount, email, JSON.stringify(subAccount));
                callback(false);
                subAccount[w.email] = email;
                webEvent({[w.subAccount]: subAccount}, id, c);
            } else {
                if (referral) await redis[c][w.hsetAsync](doc[w.mongoId], w.referral, referral);
                await redis[c][w.hsetAsync](doc[w.mongoId] + w.map, w.email, email);
                await generateCookie(doc[w.mongoId], c, callback, args);
            }
            router[w.address]("" + doc[w.mongoId], c, {[w.addressType]: w.legacy}, () => null, true);
        } catch (e) {
            return callback(true, w.UNKNOWN_ERROR);
        }
    });
};

router['signin'] = async (id, c, json, callback, args) => {
    isRestCall(args);
    const {ip} = args;
    co[w.ip] !== ip && await takeLockAsync(getCluster(ip) + ip);
    let {email, password, token, redirect} = json;
    if (!email) throw w.INVALID_EMAIL;
    email = email.toLowerCase();
    const user = await mongo[getCluster(email)].collection(w.users).findOne({email});
    if (!user || user[w.email] !== email) throw w.INVALID_EMAIL;
    if (!verifyPassword(user['passwordHash'], "" + password, "" + user.salt)) throw w.INVALID_PASSWORD;
    if (user[w.key] && !speakeasy.totp['verifyDelta']({
        secret: decrypt(user[w.tfa], Buffer.from(user[w.key], 'hex'), user[w.tfa + 'iv']),
        encoding: 'base32',
        token,
        window: 2
    })) throw w.BAD_TOKEN;
    if (user[w.subAccount] && user[w.disabled]) throw w.DISABLED_SUBACCOUNT;
    await generateCookie(user[w.mongoId], user[w.cluster], callback, args, redirect);
};

router['logout'] = async (id, c, json, callback, args) => {
    isRestCall(args);
    if (!id) throw w.UNKNOWN_ERROR;
    const token = getSessionCookie(args.req[w.headers]);
    if (token) redis[c]['del']("login" + token);
    args.res[w.headerWritten] = {
        "Set-Cookie": "session=; HttpOnly; SameSite=Strict; Secure; expires=Thu, 01 Jan 1970 00:00:00 GMT;"
    };
    callback(false);
};

function isRestCall(args) {
    if (!args.res || restricted.includes(args.req.country)) throw w.IMPOSSIBLE_OPERATION;
}

async function generateCookie(id, c, callback, args, redirect) {
    const session = c + genRandomString(128);
    await redis[w.minus + c][w.setAsync]("session" + session, "" + id);
    args.res[w.headerWritten] = {
        "Set-Cookie": "session=" + session + "; HttpOnly; path=/; SameSite=Strict; Secure;"
    };
    if (redirect) args.res[w.headerWritten]["Refresh"] = "0; url=" + (!co.isDev ? "/" : "http://localhost:3000/") + redirect;
    callback(false, session);
}