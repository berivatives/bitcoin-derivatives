const w = require('../../words'),
    co = require('../../constants'),
    {satoshi} = co,
    {fixed} = require('../../utilities/commons');

exports.setPosition = (commands, id, data, tempPosition, individuals, symbol, balances, isMaker, counterPartUsed) => {

    let position = data[w.positions][symbol], remain, temp;

    if (!position) {
        position = tempPosition;
        position[w.sum] = position[w.quantity];
        position[w.pnl] = 0;
        delete position[w.counterPart];
        delete position[w.loss];
    } else if ((position[w.quantity] > 0 && tempPosition[w.quantity] < 0) || (position[w.quantity] < 0 && tempPosition[w.quantity] > 0)) {

        Math.abs(tempPosition[w.quantity]) > Math.abs(position[w.quantity]) ? remain = Math.abs(position[w.quantity]) : remain = Math.abs(tempPosition[w.quantity]);

        if (tempPosition[w.counterPart] > 0) {
            if (tempPosition[w.counterPart] >= data[counterPartUsed]) {
                if (isMaker) commands.push([w.hdel, id, counterPartUsed]);
                data[counterPartUsed] = 0;
            } else {
                if (isMaker) commands.push([w.hincrby, id, counterPartUsed, Math.round(tempPosition[w.counterPart] * -1)]);
                data[counterPartUsed] -= tempPosition[w.counterPart];
            }
            temp = remain * position[w.price] / satoshi + (remain - tempPosition[w.counterPart]) * tempPosition[w.price] / satoshi;
        } else {
            temp = remain * position[w.price] / satoshi + remain * tempPosition[w.price] / satoshi;
        }

        if (temp > 0 && data[w.marginLocked] > 0) {
            if (temp > data[w.initMarginLocked]) {
                data[w.toReturn] += data[w.initMarginLocked];
            } else {
                data[w.toReturn] += temp;
            }
            if (temp > data[w.marginLocked]) {
                commands.push([w.hincrby, id, w.margin, Math.round(data[w.marginLocked] * -1)]);
                temp -= data[w.marginLocked];
                data[w.margin] -= data[w.marginLocked];
                data[w.marginLocked] = 0;
            } else {
                commands.push([w.hincrby, id, w.margin, Math.round(temp * -1)]);
                data[w.margin] -= temp;
                data[w.marginLocked] -= temp;
                temp = 0;
            }
        }

        if (temp > 0) {
            if (temp > data[w.locked]) temp = data[w.locked];
            data[w.free] += temp;
            data[w.locked] -= temp;
            commands.push([w.hincrby, id, w.free, Math.round(temp), w.locked, Math.round(temp * -1)]);
        }

        data[w.size] -= remain;
        data[w.exposure] -= remain * position[w.price] / satoshi;

        if (tempPosition[w.loss]) {
            temp = Math.round(tempPosition[w.loss]);
        } else {
            if (position[w.quantity] > 0) {
                temp = Math.round(remain * (tempPosition[w.price] - position[w.price]) / satoshi);
            } else {
                temp = Math.round(remain * (tempPosition[w.price] - position[w.price]) / satoshi * -1);
            }
        }

        if (temp) {
            position[w.pnl] += temp;
            data[w.free] += temp;
            commands.push([w.hincrby, id, w.free, temp]);
        }

        if (position[w.quantity] > 0) {
            position[w.quantity] += tempPosition[w.quantity];
            if (position[w.quantity] <= 0) {  // 1
                pnlCalculation(id, symbol, position, balances, commands, individuals[1]);
                if (position[w.quantity] < 0) {
                    oppositePosition(data, id, position, tempPosition, commands, symbol + w.sellUsed);
                } else {
                    position = null;
                }
            }
        } else {
            position[w.quantity] += tempPosition[w.quantity];
            if (position[w.quantity] >= 0) {  // -1
                pnlCalculation(id, symbol, position, balances, commands, individuals[1]);
                if (position[w.quantity] > 0) {
                    oppositePosition(data, id, position, tempPosition, commands, symbol + w.buyUsed);
                } else {
                    position = null;
                }
            }
        }
    } else { // increase position size
        position[w.price] = (position[w.quantity] * position[w.price]
            + tempPosition[w.quantity] * tempPosition[w.price]) / (position[w.quantity] + tempPosition[w.quantity]);
        position[w.quantity] += tempPosition[w.quantity];
        position[w.sum] += tempPosition[w.quantity];
    }

    data[w.positions][symbol] = position;

    if (!position) {
        commands.push([w.hdel, id, w.positions + symbol, symbol + w.buyUsed, symbol + w.sellUsed]);
        delete data[symbol + w.positions];
    }
};

const getPNLMessage = function (position, symbol) {
    return [
        Date.now(),
        w.pnl.toUpperCase() + " " + fixed(position[w.sum]) + symbol + w.at + fixed(position[w.price]),
        position[w.pnl]
    ];
};

exports.getPNLMessage = getPNLMessage;

function pnlCalculation(id, symbol, position, balances, commands, individuals) {
    if (position[w.pnl]) {
        const msg = getPNLMessage(position, symbol);
        balances.push({id, [w.quantity]: msg[2], [w.timestamp]: msg[0], [w.label]: msg[1]});
        commands.push([w.lpush, id + w.balance, JSON.stringify(msg)]);
        individuals.push({id, [w.msg]: {[w.balance]: msg}});
    }
}

function oppositePosition(data, id, position, tempPosition, commands, qteUsed) {
    position[w.sum] = position[w.quantity];
    position[w.price] = tempPosition[w.price];
    position[w.pnl] = 0;
    data[w.exposure] += (Math.abs(position[w.quantity]) * position[w.price] / satoshi);
    commands.push([w.hdel, id, qteUsed]);
}

exports.PNL = function (position, tempPosition) {
    if (!position) {
        return 0;
    } else if ((position[w.quantity] > 0 && tempPosition[w.quantity] < 0) || (position[w.quantity] < 0 && tempPosition[w.quantity] > 0)) {
        const remain = Math.abs(tempPosition[w.quantity]) > Math.abs(position[w.quantity]) ? Math.abs(position[w.quantity]) : Math.abs(tempPosition[w.quantity]);
        if (tempPosition[w.loss]) {
            return tempPosition[w.loss];
        } else {
            if (position[w.quantity] > 0) {
                return Math.round(remain * (tempPosition[w.price] - position[w.price]) / satoshi);
            } else {
                return Math.round(remain * (tempPosition[w.price] - position[w.price]) / satoshi * -1);
            }
        }
    } else {
        return 0;
    }
};