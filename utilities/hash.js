const crypto = require('crypto'),
    w = require('../words'),
    co = require('../constants'),
    password = crypto.createHash('sha256').update(co.uploadPassword).digest('base64').substr(0, 32),
    algorithm = 'aes-256-cbc';

const genRandomBytes = function (length) {
    return crypto.randomBytes(length);
};

const genRandomString = function genRandomString(length) {
    return genRandomBytes(length ? length / 2 : 16).toString('hex')
};

const sha512 = function (password, salt, prop) {
    const hash = crypto.createHmac('sha512', salt);
    hash.update(password);
    return {
        salt,
        [prop || 'passwordHash']: hash.digest('hex')
    };
};

module.exports.securedPassword = function (password) {
    if (!password || password.length < 7) throw w.UNSECURED_PASSWORD;
};

module.exports.verifyPassword = function (hash, password, salt) {
    return sha512(password, salt).passwordHash === hash;
};

module.exports.saltHashPassword = function (password, saltLength, prop) {
    const salt = genRandomString(saltLength || 16);
    return sha512(password, salt, prop);
};

module.exports.encrypt = function (text, key, prop) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, typeof key === "string" ? Buffer.from(key, 'hex') : Buffer.from(key), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return {[(prop ? prop : "") + "iv"]: iv.toString('hex'), [prop || 'encryptedData']: encrypted.toString('hex')};
};

module.exports.decrypt = function (text, key, ivHex) {
    let iv = Buffer.from(ivHex, 'hex');
    let encryptedText = Buffer.from(text, 'hex');
    let decipher = crypto.createDecipheriv(algorithm, Buffer.from(key), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
};

module.exports.createCipheriv = function (iv) {
    return crypto.createCipheriv(algorithm, password, iv);
};

module.exports.decryptFile = function (file, iv) {
    const decipher = crypto.createDecipheriv(algorithm, password, Buffer.from(iv, 'hex'));
    return Buffer.concat([decipher.update(file), decipher.final()]);
};

module.exports.genRandomString = genRandomString;
module.exports.genRandomBytes = genRandomBytes;