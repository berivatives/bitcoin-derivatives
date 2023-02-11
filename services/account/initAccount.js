const {satoshi} = require('../../constants'),
    w = require('../../words');

exports.initAccount = function (account, maker, sell, symbol, now, c) {

    account[w.cluster] = c;
    const toInit = [w.free, w.locked, w.fundingFree, w.fundingLocked, w.margin];
    if (symbol) {
        toInit.push(symbol + w.sellUsed);
        toInit.push(symbol + w.buyUsed);
    }

    for (let i in toInit) {
        account[toInit[i]] === undefined ? account[toInit[i]] = 0 : account[toInit[i]] = Number(account[toInit[i]]);
    }

    account[w.positions] = {};
    account[w.exposure] = 0;
    for (let key in account) {
        if (key !== w.positions && key.startsWith(w.positions)) {
            const s = key.replace(w.positions, '');
            if (account[key] !== undefined && account[key] !== null) {
                const position = JSON.parse(account[key]);
                account[w.positions][s] = position;
                account[w.exposure] += Math.abs(position[w.quantity]) * position[w.price] / satoshi;
                delete account[key];
            }
        }
    }

    if (symbol && account[w.positions][symbol]) {
        if (maker) {
            if ((sell && account[w.positions][symbol][w.quantity] < 0)
                || (!sell && account[w.positions][symbol][w.quantity] > 0)) {
                account[w.size] = Math.abs(account[w.positions][symbol][w.quantity]);
            } else {
                account[w.size] = 0;
            }
        } else {
            if ((sell && account[w.positions][symbol][w.quantity] > 0)
                || (!sell && account[w.positions][symbol][w.quantity] < 0)) {
                account[w.size] = Math.abs(account[w.positions][symbol][w.quantity]);
            } else {
                account[w.size] = 0;
            }
        }
    }

    let sum_borrow = 0, avg_borrow = 0, pnl_borrow = 0, avg_time_borrow = 0, temp;

    for (let i = 0; i < account[w.BTCList].length; i++) {
        temp = JSON.parse(account[w.BTCList][i]);
        sum_borrow += temp[w.quantity];
        avg_borrow += temp[w.quantity] * temp[w.price];
        avg_time_borrow += temp[w.quantity] * temp[w.timestamp];
        pnl_borrow += temp[w.quantity] * temp[w.price] / (3600 * 24000) / satoshi * (now - temp[w.timestamp]) * -1;
        account[w.BTCList][i] = temp;
    }
    pnl_borrow = Math.round(pnl_borrow);

    if (sum_borrow > 0) {
        account[w.BTC] = {
            [w.timestamp]: avg_time_borrow / sum_borrow,
            [w.quantity]: sum_borrow,
            [w.price]: avg_borrow / sum_borrow,
            [w.pnl]: pnl_borrow
        };
    }

    account[w.interests] = pnl_borrow;
    account[w.marginLocked] = sum_borrow;
    account[w.initMarginLocked] = sum_borrow;
    account[w.toBorrow] = 0;
    account[w.toReturn] = 0;

    if (account[w.free] + account[w.locked] <= 0) {
        account[w.leverage] = satoshi;
    } else {
        account[w.leverage] = (account[w.exposure] - account[w.interests]) / (account[w.free] + account[w.locked]);
    }
};
