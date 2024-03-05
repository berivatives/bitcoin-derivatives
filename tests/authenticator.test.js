const {strictEqual} = require('assert');
const speakeasy = require('speakeasy');
const w = require('../words');
const {httpGet, query, clearLock, clearIPLock} = require("./utilities");
const redis = require('../redis');
const mongo = require('../mongo');
const {clearCache} = require("./clearCache");

let error, data;

(async () => {

    await clearCache();
    const email = Date.now() + "@mail.com", password = "zegezg6z4e5g5ezr4ghe9z";
    ({error, data} = await httpGet('/signup' + query({email, password})));
    strictEqual(error, false, data);
    const session = data;
    const c = session[0];
    const user = await redis[w.minus + c][w.getAsync]("session" + session);

    ({error, data} = await httpGet('/' + w.tfa, session));
    strictEqual(error, false);
    const secret = data.split('=')[1];
    let token = speakeasy.totp({secret, encoding: 'base32'});
    strictEqual(await redis[w.minus + c]['existsAsync'](user + w.tfa), 1);
    strictEqual(await redis[w.minus + c][w.getAsync](user + w.tfa), secret);
    ({error} = await httpGet('/c-' + w.tfa + query({token}), session));
    strictEqual(error, false);
    strictEqual(await redis[w.minus + c]['existsAsync'](user + w.tfa), 0);
    strictEqual(await redis[c].hgetAsync(user + w.map, w.tfa), w.true);
    strictEqual((await mongo[c].collection(w.users).findOne({email})).key !== null, true);

    await clearIPLock();
    ({error, data} = await httpGet('/signin' + query({email, password})));
    strictEqual(error, true);
    strictEqual(data, w.BAD_TOKEN);

    await clearIPLock();
    ({error, data} = await httpGet('/signin' + query({email, password, token: "123456"})));
    strictEqual(error, true);
    strictEqual(data, w.BAD_TOKEN);

    await clearIPLock();
    token = speakeasy.totp({secret, encoding: 'base32'});
    ({error, data} = await httpGet('/signin' + query({email, token, password: token})));
    strictEqual(error, true);
    strictEqual(data, w.INVALID_PASSWORD);

    await clearIPLock();
    token = speakeasy.totp({secret, encoding: 'base32'});
    ({error} = await httpGet('/signin' + query({email, password, token})));
    strictEqual(error, false);

    await clearLock(user, c);
    ({error, data} = await httpGet('/d-' + w.tfa, session));
    strictEqual(error, true);
    strictEqual(data, w.BAD_TOKEN);

    await clearLock(user, c);
    ({error, data} = await httpGet('/d-' + w.tfa + query({token: "123456"}), session));
    strictEqual(error, true);
    strictEqual(data, w.BAD_TOKEN);

    await clearLock(user, c);
    token = speakeasy.totp({secret, encoding: 'base32'});
    ({error, data} = await httpGet('/d-' + w.tfa + query({token}), session));
    strictEqual(error, false);
    strictEqual(await redis[c].hgetAsync(user + w.map, w.tfa), null);
    strictEqual((mongo[c].collection(w.users).findOne({[w.id]: user})).key !== null, true);

    await clearIPLock();
    ({error} = await httpGet('/signin' + query({email, password})));
    strictEqual(error, false);

    process.exit(0);
})();

