const orderBooks = require('../markets/orderBooks').map,
    redis = require('../../redis'),
    co = require('../../constants'),
    w = require('../../words'),
    tickers = require('../markets/tickers'),
    {releaseLock} = require('../../utilities/lock'),
    {initAccount} = require("../account/initAccount"),
    {setPosition, PNL} = require("./position"),
    {save} = require("./save"),
    {hasEnoughFunds, fixed, cancelOrder, oneLineOrder, increaseBalance, wait} = require('../../utilities/commons'),
    {shouldExecuteOrder, isAutoLiquidation, reduce, makerHasFree, isHidden, infiniteProfitPNL, bitcoin} = require('./utilities'),
    satoshi = co.satoshi;

module.exports = async function matching(params) {
    try {
        let [id, c, orderId, symbol, execution, qty, sell, price, postOnly, hide, reduceOnly, redisPrice, total, myId, oco, args] = params;

        const counterPartUsedTaker = symbol + (sell ? w.sellUsed : w.buyUsed),
            counterPartUsedMaker = symbol + (!sell ? w.sellUsed : w.buyUsed),
            cs = tickers[symbol][w.cluster],
            csc = w.orderBook + cs,
            isFunding = symbol === w.BTC;

        let details = '', sumAmount = 0, fill = 0, status = w.opened,
            limit = 0, sumTakerFee = 0, maxToBorrow = {[w.quantity]: orderBooks[w.BTC][2]},
            makerId, makerCluster, ob, i, maker, realPrice, realQte,
            makerFee, takerFee, temp, tempPosition;

        const commands = {}, accounts = {}, balances = {}, orders = {}, individuals = {},
            trades = [], orderBookUpdates = [], now = Date.now(),
            takerCluster = c, takerId = id,
            taker = {
                [w.timestamp]: now,
                [w.orderId]: orderId,
                c,
                id,
                [w.quantity]: qty,
                [w.price]: price,
                [w.hidden]: hide
            };

        commands[csc] = [];
        individuals[0] = [[], []];

        initCluster(takerCluster, commands, individuals, balances, orders);

        temp = await redis[takerCluster].multi([[w.hgetall, takerId], [w.lrange, takerId + w.borrowed, 0, -1]])[w.execAsync]();
        accounts[takerId] = temp[0];
        accounts[takerId][w.BTCList] = temp[1];

        initAccount(accounts[takerId], false, sell, symbol, now, takerCluster);

        const range = total > bitcoin(1) ? 10 : total > bitcoin(0.1) ? 5 : 2;

        while (true) {

            // case range
            if (sell) ob = await redis[cs][w.zrangebyscoreAsync](symbol + w.bids, w.minusInf, redisPrice, w.WITHSCORES, w.LIMIT, range * limit, range);
            else ob = await redis[cs][w.zrangebyscoreAsync](symbol + w.asks, 0, redisPrice, w.WITHSCORES, w.LIMIT, range * limit, range);

            if (ob.length && postOnly === w.true) throw w.ORDER_CANCELLED_POST_ONLY; // case post only

            tempPosition = accounts[takerId][w.positions][symbol];

            if (ob.length && !isFunding && fill <= 0 && reduceOnly === w.true) {
                if (!tempPosition || (sell && tempPosition[w.quantity] < 0) || (!sell && tempPosition[w.quantity] > 0)) {
                    throw w.ORDER_CANCELLED_REDUCE_ONLY; // case reduce only
                }
            }

            for (i = 0; i < ob.length && taker[w.quantity] > 0; i += 2) {

                maker = JSON.parse(ob[i]);

                makerId = maker[w.id];
                makerCluster = maker[w.cluster];

                realPrice = Math.abs(ob[i + 1]);
                tempPosition = accounts[takerId][w.positions][symbol];
                commands[csc].push([w.zrem, symbol + (sell ? w.bids : w.asks), ob[i]]);

                // case auto liquidation
                isAutoLiquidation(accounts[takerId], tempPosition, realPrice, isFunding, sell);

                initCluster(makerCluster, commands, individuals, balances, orders);

                individuals[makerCluster][0].push([makerId, maker[w.orderId], makerCluster]);

                const security = await redis[makerCluster].multi([
                    [w.hmget, makerId + maker[w.orderId], w.status, w.quantity, w.fill, w.counterPart, w.reduce, w.oco, now],
                    [w.hgetall, makerId],
                    [w.lrange, makerId + w.borrowed, 0, -1]
                ]).execAsync();

                if (!accounts[makerId]) {
                    if (co.isDev && makerId.startsWith("trigger")) while (Date.now() < Number(makerId.replace("trigger", ""))) await wait(100);
                    accounts[makerId] = security[1];
                    accounts[makerId][w.BTCList] = security[2];
                    initAccount(accounts[makerId], true, sell, symbol, now, makerCluster);
                }

                // case order not opened
                if (!security[0] || security[0][0] !== w.opened) {
                    isHidden(maker, orderBookUpdates, realPrice, maker[w.quantity], sell);
                    continue;
                }

                security[0][1] *= 1;
                security[0][2] *= 1;
                security[0][3] *= 1;
                security[0][0] = security[0][1] - security[0][2];

                if (security[0][5]) {
                    commands[csc].push([w.zrem, symbol + (sell ? w.bids : w.asks) + w.STOP, JSON.stringify({
                        [w.timestamp]: maker[w.timestamp],
                        [w.orderId]: maker[w.orderId],
                        [w.cluster]: maker[w.cluster],
                        [w.id]: maker[w.id]
                    })]);
                    commands[makerCluster].push([w.hdel, makerId + maker[w.orderId], w.oco]);
                }

                maker[w.counterPart] = security[0][3];

                // case order partially filled
                if (maker[w.quantity] > security[0][0]) {
                    isHidden(maker, orderBookUpdates, realPrice, maker[w.quantity] - security[0][0], sell);
                    maker[w.quantity] = security[0][0];
                    if (maker[w.quantity] <= 0) continue;
                }

                tempPosition = accounts[makerId][w.positions][symbol];

                // case maker reduce-only
                if (!isFunding && security[0][4] === w.true) {
                    if (!tempPosition || (sell && tempPosition[w.quantity] > 0) || (!sell && tempPosition[w.quantity] < 0)) {
                        reduce(commands, maker, orderBookUpdates, orders[makerCluster], realPrice, sell);
                        continue;
                    }
                }

                // self-trade prevention - expire maker
                if (takerId === makerId && !isFunding) {
                    reduce(commands, maker, orderBookUpdates, orders[makerCluster], realPrice, sell, isFunding ? w.cancelled : w.marginCancelled);
                    continue;
                }

                // case auto liquidation maker
                if (!isFunding && tempPosition && (accounts[makerId][w.marginLocked] > 0 || (accounts[makerId][w.exposure] > accounts[makerId][w.locked] && accounts[makerId][w.margin] > 0))) {
                    if (tempPosition[w.quantity] > 0) temp = tempPosition[w.price] * (1 - 1 / accounts[makerId][w.leverage]);
                    else temp = tempPosition[w.price] * (1 + 1 / accounts[makerId][w.leverage]);
                    if ((tempPosition[w.quantity] > 0 && realPrice <= temp)
                        || (tempPosition[w.quantity] < 0 && realPrice >= temp)) {
                        reduce(commands, maker, orderBookUpdates, orders[makerCluster], realPrice, sell);
                        continue;
                    }
                }

                // case using counterPart to open or increase a position
                if (!isFunding && maker[w.counterPart] > 0) {
                    if (increasePos(tempPosition, !sell, maker[w.counterPart]) || maker[w.counterPart] > accounts[makerId][w.size]) {
                        if (maker[w.counterPart] > accounts[makerId][w.size]) {
                            temp = (maker[w.counterPart] - accounts[makerId][w.size]) * realPrice / satoshi;
                            commands[makerCluster].push([w.hincrby, makerId + maker[w.orderId], w.counterPart, (maker[w.counterPart] - accounts[makerId][w.size]) * -1]);
                            maker[w.counterPart] = Math.round(accounts[makerId][w.size]);
                        } else {
                            temp = maker[w.counterPart] * realPrice / satoshi;
                            commands[makerCluster].push([w.hincrby, makerId + maker[w.orderId], w.counterPart, maker[w.counterPart] * -1]);
                            maker[w.counterPart] = 0;
                        }
                        if (!hasEnoughFunds(makerId, accounts[makerId], commands[makerCluster], temp)) {
                            maker[w.counterPart] = security[0][3];
                            reduce(commands, maker, orderBookUpdates, orders[makerCluster], realPrice, sell);
                            continue;
                        }
                    }
                }

                tempPosition = accounts[makerId][w.positions][symbol];
                temp = accounts[takerId][w.positions][symbol];

                // case short and buy market at more than entry * 2 with more quantity than the opened position
                if (!isFunding && temp && !sell && temp[w.quantity] < 0 && temp[w.price] * 2 <= realPrice) {
                    if (taker[w.quantity] > temp[w.quantity] * -1) {
                        taker[w.quantity] = Math.round(temp[w.quantity] * -1);
                        qty = Math.round(fill + taker[w.quantity]);
                    }
                }

                if (maker[w.quantity] > taker[w.quantity]) realQte = taker[w.quantity];
                else realQte = maker[w.quantity];

                // case infinite pnl while shorting
                if (!isFunding && temp && !sell && temp[w.quantity] < 0 && temp[w.price] * 2 <= realPrice) {
                    temp = Math.round(realQte * temp[w.price] / realPrice);
                    tempPosition = accounts[takerId][w.positions][symbol];
                    if (temp <= 0) {
                        [sumAmount, details, qty, fill] = infiniteProfitPNL(tempPosition, taker, commands, balances, accounts, individuals, symbol, csc, realPrice, sell, fill, sumAmount, details, qty, ob[i], now);
                        break;
                    } else {
                        if (tempPosition[w.quantity] + realQte < 0 && maker[w.quantity] === realQte) {
                            realQte = maker[w.quantity];
                        } else {
                            realQte = temp;
                        }
                    }
                }

                // case maker needs to borrow
                if (!isFunding && realQte > maker[w.counterPart] && accounts[makerId][w.margin] > 0) {
                    temp = Math.round((realQte - maker[w.counterPart]) * realPrice / satoshi);
                    temp = makerHasFree(accounts, makerId, makerCluster, commands, temp);
                    if (temp > 0) {
                        if (temp > accounts[makerId][w.margin]) temp = accounts[makerId][w.margin];
                        if (increasePos(accounts[makerId][w.positions][symbol], !sell, realQte)) {
                            if (accounts[makerId][w.exposure] < accounts[makerId][w.free] + accounts[makerId][w.locked]) {
                                temp = accounts[makerId][w.exposure] +
                                    increasePosBy(accounts[makerId][w.positions][symbol], !sell, realQte, realPrice)
                                    - accounts[makerId][w.free] - accounts[makerId][w.locked];
                            }
                            if (temp > 2) {
                                if (temp > maxToBorrow[w.quantity]) {
                                    temp = maker[w.quantity] * realPrice / satoshi;
                                    if (accounts[makerId][w.margin] > 0) {
                                        if (accounts[makerId][w.margin] >= temp) {
                                            commands[makerCluster].push([w.hincrby, makerId, w.margin, temp * -1]);
                                            accounts[makerId][w.margin] -= temp;
                                            temp = 0;
                                        } else {
                                            commands[makerCluster].push([w.hincrby, makerId, w.margin, accounts[makerId][w.margin] * -1]);
                                            temp -= accounts[makerId][w.margin];
                                            accounts[makerId][w.margin] = 0;
                                        }
                                    }
                                    if (temp > 0) {
                                        if (temp > accounts[makerId][w.locked]) temp = accounts[makerId][w.locked];
                                        increaseBalance(commands[makerCluster], makerId, accounts[makerId], temp, isFunding);
                                    }
                                    realQte = 0;
                                } else {
                                    maxToBorrow[w.quantity] -= temp;
                                    accounts[makerId][w.marginLocked] += temp;
                                    accounts[makerId][w.toBorrow] += temp;
                                }
                            }
                        } else {
                            accounts[makerId][w.marginLocked] += temp;
                            accounts[makerId][w.toBorrow] += temp;
                        }
                    }
                }

                if (realQte <= 0 || (!isFunding && (accounts[makerId][w.free] + accounts[makerId][w.locked]) <= 0 && realQte > maker[w.counterPart])) {
                    reduce(commands, maker, orderBookUpdates, orders[makerCluster], realPrice, sell, isFunding ? w.cancelled : w.marginCancelled);
                    continue;
                }

                isHidden(maker, orderBookUpdates, realPrice, realQte, sell);

                trades.push([realPrice, realQte, now, sell ? 0 : 1]);

                if (!isFunding) {
                    takerFee = Math.round(realQte * realPrice / satoshi * co.feesTaker * -1);
                    makerFee = Math.round(realQte * realPrice / satoshi * co.feesMaker * -1);
                    if (maker[w.hidden] === w.true) {
                        temp = takerFee;
                        takerFee = makerFee;
                        makerFee = temp;
                    }
                    if (makerFee) {
                        commands[makerCluster].push([w.hincrby, makerId + maker[w.orderId], w.fee, makerFee * -1]);
                        commands[makerCluster].push([w.hincrby, makerId, w.free, makerFee]);
                    }
                    accounts[takerId][w.free] += takerFee;
                    accounts[makerId][w.free] += makerFee;
                    sumTakerFee += (takerFee * -1);

                    const referralFee = Math.abs(Math.round((makerFee + takerFee) / 2));
                    for (const accountId of [makerId, takerId]) {
                        const {ref} = accounts[accountId];
                        if (ref && ref !== w.true) {
                            const [referralId, referralCluster] = ref.split('_');
                            initCluster(referralCluster, commands, individuals, balances, orders);
                            commands[referralCluster].push([w.hincrby, referralId, w.referralFree, referralFee]);
                        }
                    }
                }

                temp = fixed(realQte) + w.at + fixed(realPrice);
                commands[makerCluster].push([w.hincrby, makerId + maker[w.orderId], w.fill, realQte]);
                commands[makerCluster].push([w.hset, makerId + maker[w.orderId], now, security[0][6] ? security[0][6] + ' ' + temp : temp]);
                details += (temp + ' ');

                // BEGIN position market MAKER
                maker[w.quantity] -= realQte;
                if (!isFunding) {
                    tempPosition = {[w.quantity]: realQte, [w.price]: realPrice, [w.counterPart]: 0};
                    temp = accounts[makerId][w.positions][symbol];
                    if (maker[w.counterPart] > 0) {
                        if (realQte > maker[w.counterPart]) {
                            tempPosition[w.counterPart] = maker[w.counterPart];
                            commands[makerCluster].push([w.hincrby, makerId + maker[w.orderId], w.counterPart, maker[w.counterPart] * -1]);
                        } else {
                            commands[makerCluster].push([w.hincrby, makerId + maker[w.orderId], w.counterPart, realQte * -1]);
                            tempPosition[w.counterPart] = realQte;
                        }
                    }
                    if (!sell) tempPosition[w.quantity] *= -1;
                    setPosition(commands[makerCluster], makerId, accounts[makerId],
                        tempPosition, individuals[makerCluster], symbol, balances[makerCluster],
                        true, counterPartUsedMaker
                    );
                }
                // END position market MAKER


                // BEGIN position market TAKER
                if (isFunding) {
                    commands[takerCluster].push([w.rpush, takerId + w.borrowed, JSON.stringify({
                        [w.timestamp]: now,
                        [w.quantity]: realQte,
                        [w.price]: realPrice,
                        [w.id]: makerId,
                        [w.cluster]: makerCluster,
                        [w.order]: [maker[w.orderId], taker[w.orderId]]
                    })]);
                    if (!accounts[takerId][w.BTC]) {
                        accounts[takerId][w.BTC] = {
                            [w.timestamp]: now,
                            [w.quantity]: realQte,
                            [w.price]: realPrice,
                            [w.pnl]: 0
                        };
                    } else {
                        accounts[takerId][w.BTC][w.price] = (accounts[takerId][w.BTC][w.quantity] * accounts[takerId][w.BTC][w.price] + realQte * realPrice) / (accounts[takerId][w.BTC][w.quantity] + realQte);
                        accounts[takerId][w.BTC][w.quantity] += realQte;
                    }
                    taker[w.quantity] -= realQte;
                } else {
                    tempPosition = {[w.quantity]: realQte, [w.price]: realPrice, [w.counterPart]: 0};
                    temp = accounts[takerId][w.positions][symbol];
                    if (temp && !sell && temp[w.quantity] < 0 && temp[w.price] * 2 <= realPrice) {
                        tempPosition[w.quantity] = Math.round(realQte * realPrice / temp[w.price]);
                        if (tempPosition[w.quantity] > temp[w.quantity] * -1) tempPosition[w.quantity] = Math.round(temp[w.quantity] * -1);
                        tempPosition[w.loss] = Math.round(tempPosition[w.quantity] * (temp[w.price] - temp[w.price] * 2) / satoshi);
                        taker[w.quantity] -= tempPosition[w.quantity];
                        qty = Math.round(qty - tempPosition[w.quantity] + realQte);
                    } else {
                        taker[w.quantity] -= realQte;
                    }

                    temp = tempPosition[w.quantity];

                    if (accounts[takerId][w.size] > 0 && (accounts[takerId][w.size] - accounts[takerId][counterPartUsedTaker]) > 0) {
                        if (temp > (accounts[takerId][w.size] - accounts[takerId][counterPartUsedTaker])) {
                            tempPosition[w.counterPart] = (accounts[takerId][w.size] - accounts[takerId][counterPartUsedTaker]);
                            temp -= tempPosition[w.counterPart];
                            accounts[takerId][counterPartUsedTaker] += tempPosition[w.counterPart];
                        } else {
                            accounts[takerId][counterPartUsedTaker] += temp;
                            tempPosition[w.counterPart] = temp;
                            temp = 0;
                        }
                    }

                    temp *= realPrice / satoshi;
                    if (sell) tempPosition[w.quantity] *= -1;

                    if (!hasEnoughFunds(takerId, accounts[takerId], commands[takerCluster], temp, maxToBorrow, PNL(accounts[takerId][w.positions][symbol], tempPosition))) throw w.INSUFFICIENT_BALANCE;
                    temp = accounts[takerId][w.positions][symbol];

                    setPosition(commands[takerCluster], takerId, accounts[takerId],
                        tempPosition, individuals[takerCluster], symbol, balances[takerCluster],
                        false, counterPartUsedTaker
                    );
                }
                // END position market TAKER

                fill += realQte;
                sumAmount += realQte * realPrice;

                if (maker[w.quantity] > 0) {
                    delete maker[w.counterPart];
                    if (sell) commands[csc].push([w.zadd, symbol + w.bids, realPrice * -1, JSON.stringify(maker)]);
                    else commands[csc].push([w.zadd, symbol + w.asks, realPrice, JSON.stringify(maker)]);
                    if (taker[w.quantity] > 0) {
                        qty = Math.round(qty - taker[w.quantity]);
                        taker[w.quantity] = 0;
                    }
                } else {
                    if (isFunding) {
                        commands[makerCluster].push([w.hset, makerId + maker[w.orderId], w.status, w.filled]);
                    } else {
                        cancelOrder(commands[makerCluster], makerId, maker[w.orderId], w.filled);
                    }
                    orders[makerCluster].push([makerId, maker[w.orderId]]);
                }
                if (taker[w.quantity] <= 0) break;
            }
            limit++;
            if (!ob.length || taker[w.quantity] <= 0) break;
        }

        if (fill >= qty) status = w.filled;

        const order = {
            [w.id]: taker[w.orderId],
            [w.timestamp]: now,
            [w.action]: sell ? w.sell : w.buy,
            [w.symbol]: symbol,
            [w.quantity]: Math.round(qty),
            [w.price]: price,
            [w.execution]: execution,
            [w.status]: status,
            [w.fill]: fill,
            [w.fee]: Math.round(sumTakerFee),
            [w.post]: postOnly,
            [w.hidden]: status === w.filled ? w.false : hide,
            [w.reduce]: reduceOnly,
            [w.counterPart]: 0
        };

        if (myId) order[w.myId] = myId;
        if (oco) order[w.oco] = oco;

        individuals[takerCluster][0].push([takerId, taker[w.orderId], takerCluster]);

        if (status === w.filled && args[w.replace]) {
            // replacing an open order which is now completely filled
            commands[takerCluster].push([w.srem, takerId + w.openOrders, taker[w.orderId]]);
        }

        if (order[w.fill] > 0) {
            if (order[w.fee]) commands[takerCluster].push([w.hincrby, takerId, w.free, order[w.fee] * -1]);
            order[w.price] = Math.round(sumAmount / order[w.fill]);
            order[String(now)] = details.substring(0, details.length - 1);
        }

        commands[takerCluster].push([w.hincrby, takerId, w.counter + w.order, 1]);

        if (!await shouldExecuteOrder(order, taker, sumAmount, commands, orderBookUpdates, orders, accounts, sell, price, symbol, csc, counterPartUsedTaker, args)) throw w.ORDER_KILLED;

        commands[takerCluster].push([w.hmset, takerId + taker[w.orderId], ...oneLineOrder(order)]);
        await save(individuals, orders, orderBookUpdates, trades, symbol, cs, csc, now, commands, balances, accounts, takerId, isFunding);
        releaseLock(c + takerId + (args[w.borrow] ? w.borrow : ""));
        return {error: false, data: order};
    } catch (e) {
        if (!w[e]) console.log(e);
        return {error: true, data: w[e] || w.UNKNOWN_ERROR};
    }
};

function increasePos(pos, sell, qte) {
    if (!pos) return true;
    if ((pos[w.quantity] < 0 && sell) || (pos[w.quantity] > 0 && !sell)) return true;
    if (pos[w.quantity] > 0 && sell && qte > pos[w.quantity]) return true;
    return pos[w.quantity] < 0 && !sell && qte + pos[w.quantity] > 0;

}

function increasePosBy(pos, sell, qte, price) {
    if (!pos) return qte * price / satoshi;
    else if ((pos[w.quantity] < 0 && sell) || (pos[w.quantity] > 0 && !sell)) return qte * price / satoshi;
    else if (pos[w.quantity] > 0 && sell && qte > pos[w.quantity]) return (qte - pos[w.quantity]) * price / satoshi;
    else if (pos[w.quantity] < 0 && !sell && qte + pos[w.quantity] > 0) return (qte + pos[w.quantity]) * price / satoshi;
    return 0;
}

function initCluster(cluster, commands, individuals, balances, orders) {
    if (!commands[cluster]) {
        commands[cluster] = [];
        individuals[cluster] = [[], []];
        balances[cluster] = [];
        orders[cluster] = [];
    }
}