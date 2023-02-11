const redis = require('../redis'),
    w = require('../words');

module.exports.releaseLock = function (lock) {
    redis[w.minus + lock[0]][w.del](lock + w.lock);
};

module.exports.extendLock = function (lock, expire) {
    redis[w.minus + lock[0]][w.set](lock + w.lock, w.true, w.expire, expire || 1);
};

module.exports.takeLockAsync = function (lock, expire, counter) {
    return new Promise((resolve, reject) => {
        takeLock(lock, function (res) {
            if (res) {
                resolve();
            } else {
                reject(w.PLEASE_DO_NOT_HURT_ME);
            }
        }, expire, counter)
    });
};

const takeLock = function takeLock(lock, callback, expire, counter) {
    // console.log(lock, counter);
    if (!expire) expire = 3;
    if (!counter) counter = 0;
    if (!lock || counter > 20 || isNaN(expire)) {
        callback(false);
        return;
    }
    redis[w.minus + lock[0]][w.set](lock + w.lock, w.true, w.notExist, w.expire, expire, function (err, result) {
        if (err) {
            callback(false);
        } else {
            if (result === null) {
                setTimeout(takeLock, 50, lock, callback, expire, counter + 1);
            } else {
                callback(true);
            }
        }
    });
};

exports.takeLock = takeLock;