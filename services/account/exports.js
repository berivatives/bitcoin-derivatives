const router = require('../../router'),
    mongo = require('../../mongo'),
    w = require('../../words'),
    {fixed, prepareExport, initDate, getCluster} = require("../../utilities/commons"),
    {takeLockAsync} = require("../../utilities/lock"),
    reg = /^\d+$/;

router[w.exports] = async (id, c, json, callback, args) => {

    await takeLockAsync(c + id, 5);

    const {res, origin} = args, {type} = json, [start, end] = initDate(json.start, json.end);

    if (!res) throw w.IMPOSSIBLE_OPERATION;
    if (type !== w.balances && type !== w.trades) throw w.IMPOSSIBLE_OPERATION;
    if (isNaN(start) || isNaN(end) || start > end) throw w.BAD_RANGE_DATE;

    prepareExport(args.req, res, type + w.csv, w.csv, origin);

    if (type === w.balances) res.write('Server Date;Label;Quantity\n');
    else res.write('Server Date;Id;Action;Symbol;Type;Status;Quantity;Price;Fill;Fee;Post-Only;Reduce-Only;Hidden;Execution Details\n');
    mongo[c]
        .collection((type === w.balances ? w.balance : w.orders) + getCluster(id))
        .find({$and: [{id: {$eq: id}}, {[w.timestamp]: {$gte: start}}, {[w.timestamp]: {$lte: end + 1000 * 3600 * 24}}]})
        .sort({[w.timestamp]: 1})
        .forEach(function (doc) {
            if (doc) {
                if (type === w.balances) {
                    res.write(new Date(doc[w.timestamp]) + ';' + doc[w.label] + (doc[w.txId] ? (w.txId + " " + doc[w.txId]) : "") + ';' + fixed(doc[w.quantity]) + '\n');
                } else {
                    if (doc[w.symbol] !== w.BTC) doc[w.action] === w.sell ? doc[w.action] = 'Sell' : doc[w.action] = 'Buy';
                    else doc[w.action] === w.sell ? doc[w.action] = 'Lend' : doc[w.action] = 'Borrow';

                    if (doc[w.status] === w.cancelled) {
                        doc[w.status] = 'Cancelled';
                    } else if (doc[w.status] === w.filled) {
                        doc[w.status] = 'Filled';
                    } else if (doc[w.status] === w.killed) {
                        doc[w.status] = 'Killed';
                    } else if (doc[w.status] === w.opened) {
                        doc[w.status] = 'Active';
                    } else if (doc[w.status] === w.triggered) {
                        doc[w.status] = 'Triggered';
                    } else if (doc[w.status] === w.stopFailed) {
                        doc[w.status] = 'Stop Failed';
                    } else if (doc[w.status] === w.marginCancelled) {
                        doc[w.status] = 'Margin Cancelled - Not enough funds to borrow @ the execution';
                    }

                    let exec = "";

                    for (let fi in doc) if (reg.test(fi)) exec += (doc[fi] + " ");

                    if (!doc[w.fee]) doc[w.fee] = 0;

                    res.write(
                        new Date(parseInt(doc[w.timestamp])) + ';' +
                        doc[w.mongoId] + ';' +
                        doc[w.action] + ';' +
                        doc[w.symbol] + ';' +
                        doc[w.execution] + ';' +
                        doc[w.status] + ';' +
                        fixed(doc[w.quantity]) + ';' +
                        (doc[w.price] !== w.minus ? fixed(doc[w.price]) : doc[w.price]) + ';' +
                        fixed(doc[w.fill]) + ';' +
                        fixed(doc[w.fee]) + ';' +
                        doc[w.post] + ';' +
                        doc[w.reduce] + ';' +
                        doc[w.hidden] + ';' +
                        exec + '\n'
                    );
                }
            }
        }, function () {
            callback();
        });
};