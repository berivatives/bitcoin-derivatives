const {Readable} = require('stream');

module.exports = (res, buffer, callback) => {
    res.id = 1;
    pipeStreamOverResponse(res, Readable.from(buffer), buffer.length, callback);
};

function toArrayBuffer(buffer) {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function onAbortedOrFinishedResponse(res, readStream, callback) {
    if (res.id !== -1) {
        readStream.destroy();
        callback && callback();
    }
    res.id = -1;
}

function pipeStreamOverResponse(res, readStream, totalSize, callback) {
    readStream.on('data', (chunk) => {
        const ab = toArrayBuffer(chunk),
            lastOffset = res.getWriteOffset(),
            [ok, done] = res.tryEnd(ab, totalSize);
        if (done) {
            onAbortedOrFinishedResponse(res, readStream, callback);
        } else if (!ok) {
            readStream.pause();
            res.ab = ab;
            res.abOffset = lastOffset;
            res.onWritable((offset) => {
                const [ok, done] = res.tryEnd(res.ab.slice(offset - res.abOffset), totalSize);
                if (done) {
                    onAbortedOrFinishedResponse(res, readStream, callback);
                } else if (ok) {
                    readStream.resume();
                }
                return ok;
            });
        }
    });
    res.onAborted(() => onAbortedOrFinishedResponse(res, readStream, callback));
}