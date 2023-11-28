const fs = require('fs'),
    {spawn} = require('child_process'),
    {ObjectId} = require('mongodb'),
    co = require('../constants'),
    w = require('../words'),
    redis = require('../redis'),
    mongo = require('../mongo'),
    cors = require('./cors'),
    {decryptFile} = require("./hash"),
    download = require('./download');

exports.wait = function (time) {
    return new Promise(resolve => {
        setTimeout(function () {
            resolve()
        }, time || 1000);
    });
};

exports.roundTo = function (qty, precision) {
    // noinspection JSCheckFunctionSignatures
    return +(Math.round(qty + 'e+' + precision) + 'e-' + precision);
};

exports.initDate = function (start, end) {
    return [
        new Date(new Date(start * 1).setHours(0, 0, 0, 0)).getTime(),
        new Date(new Date(end * 1).setHours(24, 0, 0, 0)).getTime()
    ];
};

exports.hasEnoughFunds = function (id, account, commands, amount, maxToBorrow, PNL) {
    if (amount > 0) {
        if ((account[w.free] + account[w.locked] + (PNL || 0)) * co.maxLeverage - account[w.margin] - account[w.locked] >= amount) {
            if (account[w.free] >= amount) {
                reduceBalance(commands, id, account, amount);
                amount = 0;
            } else {
                account[w.locked] += account[w.free];
                amount -= account[w.free];
                commands.push([w.hincrby, id, w.free, Math.round(account[w.free] * -1), w.locked, Math.round(account[w.free])]);
                account[w.free] = 0;
            }
            if (maxToBorrow === undefined && PNL === undefined && amount > 0 && account[w.exposure] < account[w.free] + account[w.locked]) {
                amount -= (account[w.free] + account[w.locked] - account[w.exposure]);
            }
            if (amount > 0) {
                account[w.margin] += amount;
                commands.push([w.hincrby, id, w.margin, Math.round(amount)]);
                if (maxToBorrow) {
                    account[w.toBorrow] += amount;
                    if (amount > maxToBorrow[w.quantity]) throw w.NOT_ENOUGH_FUNDS_TO_BORROW;
                    else maxToBorrow[w.quantity] -= amount;
                }
            }
        } else {
            return false;
        }
    }
    return true;
};

exports.oneLineOrder = function (order) {
    const oneLineOrder = [];
    for (let i in order) {
        oneLineOrder.push(i);
        oneLineOrder.push(order[i]);
    }
    return oneLineOrder;
};

exports.increaseBalance = function (commands, id, account, amount, funding) {
    reduceBalance(commands, id, account, amount * -1, funding);
};

const reduceBalance = function (commands, id, account, amount, funding) {
    const free = funding ? w.fundingFree : w.free;
    const locked = funding ? w.fundingLocked : w.locked;
    account[free] -= amount;
    account[locked] += amount;
    commands.push([w.hincrby, id, free, Math.round(amount * -1), locked, Math.round(amount)]);
};

exports.reduceBalance = reduceBalance;

exports.cancelOrder = function (commands, id, orderId, arg) {
    commands.push([w.hset, id + orderId, w.status, arg || w.cancelled]);
    commands.push([w.srem, id + w.openOrders, orderId]);
    commands.push([w.lpush, id + w.closedOrders, orderId]);
};

exports.isBadPrice = function (p) {
    return isNaN(p) || p <= 0 || p >= 100e8 || p === Infinity || !p;
};

const osCommand = function (command, args, stderr) {
    return new Promise(resolve => {
        const process = spawn(command, args || []);
        let result = "";

        process.stdout.on('data', (data) => {
            result += data;
        });

        if (stderr) process.stderr.on('data', (data) => {
            result += data;
        });

        process.on('error', () => {
        });

        process.on('close', (code) => {
            resolve({code, result});
        });

    });
};

exports.osCommand = osCommand;

const capitalize = (s) => {
    if (typeof s !== 'string') return '';
    return s.charAt(0).toUpperCase() + s.slice(1)
};

const prepareExport = function (req, res, fileName, extension, origin) {
    const filename = encodeURIComponent(capitalize(fileName));
    const headers = {
        'Content-Type': co[w.extensions][extension],
        'Content-Disposition': 'inline; filename=\"' + filename + '\"',
        ...cors(origin || "*")
    };
    res.writeStatus('200 OK');
    for (let i in headers) res.writeHeader(i, "" + headers[i]);
    res[w.headerWritten] = true;
};
exports.prepareExport = prepareExport;

exports.exportFile = function (req, res, fileId, fileName, origin, callback) {
    prepareExport(req, res, fileName, fileName.substring(fileName.indexOf('.')), origin);
    download(res, decryptFile(fs.readFileSync(co.__dirname + '/upload/' + fileId), fileId), callback);
};

exports.webEvent = function (msg, id, c) {
    publish({[w.individuals]: [{id, [w.api]: false, msg}]}, c);
};

const publish = function (msg, c, channel) {
    redis[w.minus + c].publish(channel || w.events, JSON.stringify(msg));
};

exports.publish = publish;

exports.getIp = function (obj) {
    return Buffer.from(obj.getRemoteAddressAsText()).toString();
};

exports.fixed = function (number, precision) {
    return Number(number / co.satoshi).toFixed(precision || 8);
};

const getCluster = function (entry) {
    return String(crc(entry))[0];
};

exports.getCluster = getCluster;

exports.saveOrder = function (id, c, order, internal) {
    order[w.timestamp] *= 1;
    order[w.fee] *= 1;
    order[w.mongoId] = ObjectId(order[w.id]);
    order[w.id] = id;
    if (internal) order[w.myId] = "internal";
    mongo[c].collection(w.orders + getCluster(id)).insertOne(order);
};

exports.isBan = async function (ip) {
    const c = getCluster(ip);
    const ban = await redis[w.minus + c][w.incrbyAsync](ip, 1);
    if (ban <= 1) redis[w.minus + c].expire(ip, 60);
    if (ban > 300) throw w.PLEASE_DO_NOT_HURT_ME;
};

exports.formatRedisList = function (str) {
    return JSON.parse('[' + String(str).replace('\'', '') + ']');
};

exports.getRights = function (json) {
    return [json[w.withdraw] === true, json[w.address] === true];
};

const b_table =
    "00000000 77073096 EE0E612C 990951BA 076DC419 706AF48F E963A535 9E6495A3 0EDB8832 79DCB8A4 E0D5E91E 97D2D988 09B64C2B 7EB17CBD E7B82D07 90BF1D91 1DB71064 6AB020F2 F3B97148 84BE41DE 1ADAD47D 6DDDE4EB F4D4B551 83D385C7 136C9856 646BA8C0 FD62F97A 8A65C9EC 14015C4F 63066CD9 FA0F3D63 8D080DF5 3B6E20C8 4C69105E D56041E4 A2677172 3C03E4D1 4B04D447 D20D85FD A50AB56B 35B5A8FA 42B2986C DBBBC9D6 ACBCF940 32D86CE3 45DF5C75 DCD60DCF ABD13D59 26D930AC 51DE003A C8D75180 BFD06116 21B4F4B5 56B3C423 CFBA9599 B8BDA50F 2802B89E 5F058808 C60CD9B2 B10BE924 2F6F7C87 58684C11 C1611DAB B6662D3D 76DC4190 01DB7106 98D220BC EFD5102A 71B18589 06B6B51F 9FBFE4A5 E8B8D433 7807C9A2 0F00F934 9609A88E E10E9818 7F6A0DBB 086D3D2D 91646C97 E6635C01 6B6B51F4 1C6C6162 856530D8 F262004E 6C0695ED 1B01A57B 8208F4C1 F50FC457 65B0D9C6 12B7E950 8BBEB8EA FCB9887C 62DD1DDF 15DA2D49 8CD37CF3 FBD44C65 4DB26158 3AB551CE A3BC0074 D4BB30E2 4ADFA541 3DD895D7 A4D1C46D D3D6F4FB 4369E96A 346ED9FC AD678846 DA60B8D0 44042D73 33031DE5 AA0A4C5F DD0D7CC9 5005713C 270241AA BE0B1010 C90C2086 5768B525 206F85B3 B966D409 CE61E49F 5EDEF90E 29D9C998 B0D09822 C7D7A8B4 59B33D17 2EB40D81 B7BD5C3B C0BA6CAD EDB88320 9ABFB3B6 03B6E20C 74B1D29A EAD54739 9DD277AF 04DB2615 73DC1683 E3630B12 94643B84 0D6D6A3E 7A6A5AA8 E40ECF0B 9309FF9D 0A00AE27 7D079EB1 F00F9344 8708A3D2 1E01F268 6906C2FE F762575D 806567CB 196C3671 6E6B06E7 FED41B76 89D32BE0 10DA7A5A 67DD4ACC F9B9DF6F 8EBEEFF9 17B7BE43 60B08ED5 D6D6A3E8 A1D1937E 38D8C2C4 4FDFF252 D1BB67F1 A6BC5767 3FB506DD 48B2364B D80D2BDA AF0A1B4C 36034AF6 41047A60 DF60EFC3 A867DF55 316E8EEF 4669BE79 CB61B38C BC66831A 256FD2A0 5268E236 CC0C7795 BB0B4703 220216B9 5505262F C5BA3BBE B2BD0B28 2BB45A92 5CB36A04 C2D7FFA7 B5D0CF31 2CD99E8B 5BDEAE1D 9B64C2B0 EC63F226 756AA39C 026D930A 9C0906A9 EB0E363F 72076785 05005713 95BF4A82 E2B87A14 7BB12BAE 0CB61B38 92D28E9B E5D5BE0D 7CDCEFB7 0BDBDF21 86D3D2D4 F1D4E242 68DDB3F8 1FDA836E 81BE16CD F6B9265B 6FB077E1 18B74777 88085AE6 FF0F6A70 66063BCA 11010B5C 8F659EFF F862AE69 616BFFD3 166CCF45 A00AE278 D70DD2EE 4E048354 3903B3C2 A7672661 D06016F7 4969474D 3E6E77DB AED16A4A D9D65ADC 40DF0B66 37D83BF0 A9BCAE53 DEBB9EC5 47B2CF7F 30B5FFE9 BDBDF21C CABAC28A 53B39330 24B4A3A6 BAD03605 CDD70693 54DE5729 23D967BF B3667A2E C4614AB8 5D681B02 2A6F2B94 B40BBE37 C30C8EA1 5A05DF1B 2D02EF8D"
        .split(' ')
        .map(function (s) {
            return parseInt(s, 16)
        });

const crc = function (str) {
    let crc = -1, i = 0, iTop = str.length;
    for (; i < iTop; i++) {
        crc = (crc >>> 8) ^ b_table[(crc ^ str.charCodeAt(i)) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
};

exports.crc = crc;

exports.validateEmail = function (email) {
    // noinspection RegExpRedundantEscape
    const re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(String(email).toLowerCase());
};