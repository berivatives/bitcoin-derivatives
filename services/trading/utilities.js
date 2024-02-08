const {satoshi, minimalOrderSAT, maxLeverage} = require('../../constants'),
    w = require('../../words'),
    tickers = require('../markets/tickers'),
    {hasEnoughFunds, reduceBalance, fixed, cancelOrder, isBadPrice} = require('../../utilities/commons'),
    {PNL} = require("./position");

exports.reduce = function (commands, trader, orderBookUpdates, orders, price, sell, arg) {
    cancelOrder(commands[trader.c], trader[w.id], trader[w.orderId], arg);
    isHidden(trader, orderBookUpdates, price, trader[w.quantity], sell);
    orders.push([trader[w.id], trader[w.orderId]]);
};

const isHidden = function (order, orderBookUpdates, price, quantity, sell) {
    if (order[w.hidden] !== w.true) orderBookUpdates.push([price, w.minus, quantity, sell ? 0 : 1]);
};

exports.isHidden = isHidden;

const isAutoLiquidation = function (account, tempPosition, realPrice, isFunding, sell) {
    if (!isFunding && tempPosition && account[w.initMarginLocked] > 0 && account[w.leverage] > 1) {
        if (tempPosition[w.quantity] > 0 && sell) {
            if (realPrice <= tempPosition[w.price] * (1 - 1 / account[w.leverage])) throw w.AUTO_LIQUIDATION_FORBIDDEN_TO_PROTECT_LENDERS;
        } else if (tempPosition[w.quantity] < 0 && !sell) {
            if (realPrice >= tempPosition[w.price] * (1 + 1 / account[w.leverage])) throw w.AUTO_LIQUIDATION_FORBIDDEN_TO_PROTECT_LENDERS;
        }
    }
};

exports.isAutoLiquidation = isAutoLiquidation;

exports.extractField = function (json, sell, symbol) {
    let execution = String(json[w.execution]),
        qty = Math.round(String(json[w.quantity]) * 1),
        price = Math.round(String(json[w.price]) * 1),
        postOnly = String(String(json[w.post]) === w.true),
        hide = String(String(json[w.hidden]) === w.true),
        reduceOnly = String(String(json[w.reduce]) === w.true),
        myId = String(json[w.myId]),
        redisPrice, total, oco;

    if (!myId.match(/^[0-9a-z]+$/) || myId === 'undefined' || myId.length > 50) myId = null;

    if (execution !== w.GTC && execution !== w.MKT && execution !== w.IOC
        && execution !== w.FOK && execution !== w.STOP) {
        throw w.UNKNOWN_EXECUTION_TYPE;
    }

    if (execution !== w.GTC) {
        if (symbol === w.BTC && sell) throw w.IMPOSSIBLE_OPERATION;
        postOnly = w.false;
        hide = w.false;
    }

    if (json[w.oco] !== undefined && json[w.oco] !== null) {
        if (symbol === w.BTC || execution !== w.GTC) throw w.IMPOSSIBLE_OPERATION;
        oco = Math.round(String(json[w.oco]) * 1);
        if (isBadPrice(oco)) throw w.BAD_PRICE;
        if ((sell && oco >= price) || (!sell && oco <= price)) throw w.AUTO_TRIGGER_STOP_ORDER;
        if (tickers[symbol][w.lastValue] > 0) {
            if ((sell && oco > tickers[symbol][w.lastValue]) || (!sell && oco < tickers[symbol][w.lastValue])) throw w.AUTO_TRIGGER_STOP_ORDER;
        }
    }

    if (isNaN(qty) || qty <= 0 || !qty) throw w.BAD_QUANTITY;

    if (symbol === w.BTC) {
        if (sell) {
            if (isBadPrice(price)) throw w.BAD_PRICE;
            if (price > 0.06 * satoshi) throw w.MAX_6_PERCENT_A_DAY;
            redisPrice = price * -1;
        } else {
            redisPrice = w.plusInf;
        }
        total = qty;
    } else {
        if (sell) {
            if (execution === w.MKT) price = 1;
            if (isBadPrice(price)) throw w.BAD_PRICE;
            redisPrice = price * -1;
        } else {
            if (execution === w.MKT) {
                price = w.plusInf;
            } else {
                if (isBadPrice(price)) throw w.BAD_PRICE;
            }
            redisPrice = price;
        }
        if (execution === w.MKT) {
            total = qty * tickers[symbol][w.lastValue] / satoshi;
        } else {
            total = qty * price / satoshi;
        }
    }

    if (qty === Infinity || price === Infinity || total >= Number.MAX_VALUE || qty >= Number.MAX_VALUE || price >= Number.MAX_VALUE) {
        throw w.OUT_OF_RANGE;
    }

    return {execution, qty, price, postOnly, hide, reduceOnly, redisPrice, total, myId, oco};
};

exports.infiniteProfitPNL = function (position, taker, commands, balances, accounts, individuals, symbol, csc, realPrice, sell, fill, sumAmount, details, qty, maker, now) {
    let temp;

    position[w.loss] = Math.round(Math.abs(position[w.quantity]) * position[w.price] / satoshi * -1);
    if (position[w.loss] * -1 > accounts[taker[w.id]][w.locked]) {
        position[w.loss] = Math.round(accounts[taker[w.id]][w.locked] * -1);
    }
    temp = [now, "PNL " + fixed(position[w.sum]) + symbol + w.at + fixed(position[w.price]), position[w.loss]];
    balances[taker.c].push({
        [w.id]: taker[w.id],
        [w.timestamp]: temp[0],
        [w.label]: temp[1],
        [w.quantity]: temp[2]
    });
    individuals[taker.c][1].push({[w.id]: taker[w.id], [w.msg]: {[w.balance]: temp}});
    individuals[taker.c][1].push({
        [w.id]: taker[w.id],
        [w.msg]: {[w.symbol]: symbol, [w.positions]: null}
    });
    commands[taker.c].push([w.lpush, taker[w.id] + w.balance, JSON.stringify(temp)]);

    temp = Math.round(Math.abs(position[w.quantity]) * position[w.price] / satoshi);

    if (accounts[taker[w.id]][w.locked] - temp < 0) temp = accounts[w.locked];
    accounts[taker[w.id]][w.locked] -= temp;
    commands[taker.c].push([w.hincrby, taker[w.id], w.locked, Math.round(temp * -1)]);
    commands[taker.c].push([w.hdel, taker[w.id], w.positions + symbol]);
    accounts[taker[w.id]][w.positions][symbol] = null;
    if (sell) commands[csc].push([w.zadd, symbol + w.bids, realPrice * -1, maker]);
    else commands[csc].push([w.zadd, symbol + w.asks, realPrice, maker]);
    fill += 1;
    sumAmount += realPrice;
    temp = fixed(1) + w.at + fixed(realPrice) + ' ';
    details += temp;
    taker.q = 0;
    qty = fill;

    return [sumAmount, details, qty, fill];
};

exports.basicBalanceCheck = function (free, locked, margin, position, sell, total, qty, price, execution, symbol, counterPartUsed, verification) {
    if (symbol === w.BTC) {
        if (sell && verification === w.false) throw w.VERIFICATION_REQUIRED;
        if (sell && qty > free) throw w.INSUFFICIENT_BALANCE;
    } else {
        if (!position || (sell && position[w.quantity] < 0) || (!sell && position[w.quantity] > 0)) {
            if (verification === w.false || (verification !== w.true && tickers[symbol][w.verification] === w.true)) throw w.VERIFICATION_REQUIRED;
            if (total < minimalOrderSAT) throw w.MINIMAL_AMOUNT;
            if (total > (free + locked) * maxLeverage - margin - locked) throw w.INSUFFICIENT_BALANCE;
        } else {
            const positionSize = Math.abs(position[w.quantity]);
            total = qty * (execution === w.MKT ? tickers[symbol][w.lastValue] : price) / satoshi;
            if (total < minimalOrderSAT && qty < positionSize) throw w.MINIMAL_AMOUNT;
            if (qty + counterPartUsed > positionSize) {
                if (verification === w.false) throw w.VERIFICATION_REQUIRED; // can still reduce an open position
                if (execution === w.MKT) {
                    total = (qty + counterPartUsed - positionSize) * tickers[symbol][w.lastValue] / satoshi;
                } else {
                    total = (qty + counterPartUsed - positionSize) * price / satoshi;
                }
                if (total > (free + locked) * maxLeverage - margin - locked) throw w.INSUFFICIENT_BALANCE;
            }
        }
    }
    return total;
};

exports.makerHasFree = function (accounts, makerId, makerCluster, commands, amount) {
    if (accounts[makerId][w.free] > 0) {
        if (accounts[makerId][w.free] > amount) {
            reduceBalance(commands[makerCluster], makerId, accounts[makerId], amount, false);
            if (accounts[makerId][w.margin] > amount) {
                accounts[makerId][w.margin] -= amount;
                commands[makerCluster].push([w.hincrby, makerId, w.margin, amount * -1]);
            } else {
                commands[makerCluster].push([w.hincrby, makerId, w.margin, accounts[makerId][w.margin] * -1]);
                accounts[makerId][w.margin] = 0;
            }
            amount = 0;
        } else {
            accounts[makerId][w.locked] += accounts[makerId][w.free];
            commands[makerCluster].push([w.hincrby, makerId, w.locked, accounts[makerId][w.free], w.free, accounts[makerId][w.free] * -1]);
            if (accounts[makerId][w.margin] > accounts[makerId][w.free]) {
                accounts[makerId][w.margin] -= accounts[makerId][w.free];
                commands[makerCluster].push([w.hincrby, makerId, w.margin, accounts[makerId][w.free] * -1]);
            } else {
                commands[makerCluster].push([w.hincrby, makerId, w.margin, accounts[makerId][w.margin] * -1]);
                accounts[makerId][w.margin] = 0;
            }
            amount -= accounts[makerId][w.free];
            accounts[makerId][w.free] = 0;
        }
    }
    return amount;
};

exports.shouldExecuteOrder = async function (order, taker, sumAmount, commands, orderBookUpdates, orders, accounts, sell, price, symbol, csc, counterPartUsedTaker) {
    let temp, execute;

    if (order[w.execution] === w.GTC && taker[w.quantity] > 0) {
        order[w.price] = price;
        commands[taker[w.cluster]].push([w.sadd, taker[w.id] + w.openOrders, taker[w.orderId]]);

        if (symbol !== w.BTC) {

            temp = accounts[taker[w.id]][w.positions][symbol];

            isAutoLiquidation(accounts[taker[w.id]], temp, order[w.price], false, sell);

            if (temp && !sell && temp[w.quantity] < 0 && order[w.price] > temp[w.price]) {
                if (temp[w.price] * 2 < order[w.price]) throw w.USE_MARKET_OR_STOP_ORDER_INSTEAD;
            }

            temp = taker[w.quantity];

            if (accounts[taker[w.id]][w.size] > 0 && (accounts[taker[w.id]][w.size] - accounts[taker[w.id]][counterPartUsedTaker]) > 0) {
                if (temp > (accounts[taker[w.id]][w.size] - accounts[taker[w.id]][counterPartUsedTaker])) {
                    taker[w.counterPart] = Math.round(accounts[taker[w.id]][w.size] - accounts[taker[w.id]][counterPartUsedTaker]);
                    temp -= accounts[taker[w.id]][w.size] - accounts[taker[w.id]][counterPartUsedTaker];
                } else {
                    taker[w.counterPart] = Math.round(temp);
                    temp = 0;
                }
                order[w.counterPart] = taker[w.counterPart];
                commands[taker[w.cluster]].push([w.hincrby, taker[w.id], counterPartUsedTaker, taker[w.counterPart]]);
                delete taker[w.counterPart];
            }

            const pnl = PNL(accounts[taker[w.id]][w.positions][symbol], {
                [w.quantity]: sell ? temp * -1 : temp,
                [w.price]: order[w.price]
            });

            temp *= order[w.price] / satoshi;

            if (!hasEnoughFunds(taker[w.id], accounts[taker[w.id]], commands[taker[w.cluster]], temp, 0, pnl)) throw w.INSUFFICIENT_BALANCE;
        } else {
            reduceBalance(commands[taker[w.cluster]], taker[w.id], accounts[taker[w.id]], order[w.quantity], true);
        }

        if (taker[w.hidden] !== w.true) orderBookUpdates.push([order[w.price], w.plus, taker[w.quantity], sell ? 1 : 0]);

        commands[csc].push([
            w.zadd,
            symbol + (sell ? w.asks : w.bids),
            sell ? order[w.price] : Math.round(order[w.price] * -1),
            JSON.stringify({
                [w.timestamp]: taker[w.timestamp],
                [w.orderId]: taker[w.orderId],
                [w.cluster]: taker[w.cluster],
                [w.id]: taker[w.id],
                [w.quantity]: taker[w.quantity],
                [w.hidden]: taker[w.hidden]
            })
        ]);
        if (order[w.oco]) {
            commands[csc].push([
                w.zadd,
                symbol + (sell ? w.asks : w.bids) + w.STOP,
                order[w.oco],
                JSON.stringify({
                    [w.timestamp]: taker[w.timestamp],
                    [w.orderId]: taker[w.orderId],
                    [w.cluster]: taker[w.cluster],
                    [w.id]: taker[w.id]
                })
            ]);
        }
        execute = true;
    } else if (order[w.execution] === w.FOK && taker[w.quantity] > 0) {
        execute = false;
        order[w.status] = w.killed;
        order[w.fill] = 0;
        order[w.fee] = 0;
        order[w.counterPart] = 0;
    } else if ((order[w.execution] === w.IOC || order[w.execution] === w.FOK || order[w.execution] === w.MKT || order[w.execution] === w.GTC) && taker[w.quantity] <= 0) {
        order[w.price] = Math.round(sumAmount / order[w.fill]);
        order[w.status] = w.filled;
        commands[taker[w.cluster]].push([w.lpush, taker[w.id] + w.closedOrders, taker[w.orderId]]);
        orders[taker[w.cluster]].push([taker[w.id], taker[w.orderId]]);
        execute = true;
    } else if ((order[w.execution] === w.IOC || order[w.execution] === w.MKT) && taker[w.quantity] > 0) {
        if (order[w.fill] > 0) {
            order[w.status] = w.cancelled;
            execute = true;
            order[w.price] = Math.round(sumAmount / order[w.fill]);
        } else {
            order[w.status] = w.killed;
            execute = false;
            if (order[w.execution] === w.MKT) order[w.price] = w.minus;
        }
        commands[taker[w.cluster]].push([w.lpush, taker[w.id] + w.closedOrders, taker[w.orderId]]);
        orders[taker[w.cluster]].push([taker[w.id], taker[w.orderId]]);
    }
    return execute;
};

exports.bitcoin = function (amount) {
    return amount * satoshi;
};