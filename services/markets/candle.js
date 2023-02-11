const seconds = {
    '1S': 1000,
    '5S': 1000 * 5,
    '15S': 1000 * 15,
    '30S': 1000 * 30,
};

let intervals = {
    '1': 1000 * 60,
    '5': 1000 * 60 * 5,
    '15': 1000 * 60 * 15,
    '30': 1000 * 60 * 30,
    '60': 1000 * 60 * 60,
    '120': 1000 * 60 * 60 * 2,
    '240': 1000 * 60 * 60 * 4,
    '720': 1000 * 60 * 60 * 12,
    '1D': 1000 * 60 * 60 * 24
};

const sortedIntervals = [];
for (let i in seconds) sortedIntervals.push(i);
for (let i in intervals) sortedIntervals.push(i);

intervals = {...seconds, ...intervals};

const openCandle = function (i, o, h, l, c, v, bv) {
    const [s, e] = getDates(i);
    return [s, o, h, l, c, v, bv, e];
    //     [0, 1, 2, 3, 4, 5,  6, 7]
};

function getDates(inter) {
    let d = new Date(), start, end, minute, hour;
    if (inter === '1S') {
        start = d.setUTCMilliseconds(0);
        end = d.setUTCMilliseconds(1000 - 1);
    } else if (inter === '5S') {
        while (d.getSeconds() % 5 !== 0) d.setSeconds(d.getSeconds() - 1);
        start = d.setUTCMilliseconds(0);
        end = d.setUTCMilliseconds(5000 - 1);
    } else if (inter === '15S') {
        while (d.getSeconds() % 15 !== 0) d.setSeconds(d.getSeconds() - 1);
        start = d.setUTCMilliseconds(0);
        end = d.setUTCMilliseconds(15000 - 1);
    } else if (inter === '30S') {
        while (d.getSeconds() % 30 !== 0) d.setSeconds(d.getSeconds() - 1);
        start = d.setUTCMilliseconds(0);
        end = d.setUTCMilliseconds(30000 - 1);
    } else if (inter === '1') {
        d.setUTCSeconds(0);
        start = d.setUTCMilliseconds(0);
        end = d.setUTCMilliseconds(60 * 1000 - 1);
    } else if (inter === '5') {
        minute = d.getUTCMinutes();
        if (minute <= 4) {
            d.setUTCMinutes(0);
        } else {
            d.setUTCMinutes(minute - minute % 5);
        }
        d.setUTCSeconds(0);
        start = d.setUTCMilliseconds(0);
        end = d.setUTCMilliseconds(60 * 1000 * 5 - 1);
    } else if (inter === '15') {
        minute = d.getUTCMinutes();
        if (minute <= 14) {
            d.setUTCMinutes(0);
        } else {
            d.setUTCMinutes(minute - minute % 15);
        }
        d.setUTCSeconds(0);
        start = d.setUTCMilliseconds(0);
        end = d.setUTCMilliseconds(60 * 1000 * 15 - 1);
    } else if (inter === '30') {
        minute = d.getUTCMinutes();
        if (minute <= 29) {
            d.setUTCMinutes(0);
        } else {
            d.setUTCMinutes(minute - minute % 30);
        }
        d.setUTCSeconds(0);
        start = d.setUTCMilliseconds(0);
        end = d.setUTCMilliseconds(60 * 1000 * 30 - 1);
    } else if (inter === '60') {
        d.setUTCMinutes(0);
        d.setUTCSeconds(0);
        start = d.setUTCMilliseconds(0);
        end = d.setUTCMilliseconds(60 * 1000 * 60 - 1);
    } else if (inter === '120') {
        hour = d.getUTCHours();
        if (hour <= 1) {
            d.setUTCHours(0);
        } else {
            d.setUTCHours(hour - hour % 2);
        }
        d.setUTCMinutes(0);
        d.setUTCSeconds(0);
        start = d.setUTCMilliseconds(0);
        end = d.setUTCMilliseconds(60 * 1000 * 60 * 2 - 1);
    } else if (inter === '240') {
        hour = d.getUTCHours();
        if (hour <= 3) {
            d.setUTCHours(0);
        } else {
            d.setUTCHours(hour - hour % 4);
        }
        d.setUTCMinutes(0);
        d.setUTCSeconds(0);
        start = d.setUTCMilliseconds(0);
        end = d.setUTCMilliseconds(60 * 1000 * 60 * 4 - 1);
    } else if (inter === '720') {
        hour = d.getUTCHours();
        if (hour <= 11) {
            d.setUTCHours(0);
        } else {
            d.setUTCHours(hour - hour % 12);
        }
        d.setUTCMinutes(0);
        d.setUTCSeconds(0);
        start = d.setUTCMilliseconds(0);
        end = d.setUTCMilliseconds(60 * 1000 * 60 * 12 - 1);
    } else if (inter === '1D') {
        d.setUTCHours(0);
        d.setUTCMinutes(0);
        d.setUTCSeconds(0);
        start = d.setUTCMilliseconds(0);
        end = d.setUTCMilliseconds(60 * 1000 * 60 * 24 - 1);
    }
    return [start, end];
}

module.exports.openCandle = openCandle;
module.exports.intervals = intervals;
module.exports.sortedIntervals = sortedIntervals;
