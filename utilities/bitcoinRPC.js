const http = require('http'),
    co = require('../constants');

module.exports = async function (method, params, hostname, port) {
    const content = JSON.stringify({method, params});
    return new Promise((resolve) => {
        let data = "";
        const req = http.request({
            hostname: hostname || co.bitcoinIP,
            port: port || co.bitcoinPort,
            path: '/',
            method: 'POST'
        }, function (res) {
            res.on('data', (chunk => {
                data += chunk;
            }));
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.error) json.code = json.error.code;
                    else json.code = 0;
                    resolve(json);
                } catch (e) {
                    resolve({code: -1});
                }
            });
            res.on('error', () => {
                resolve({code: -1});
            })

        }).on('error', () => {
            resolve({code: -1});
        });
        req.setHeader('Content-Length', content.length);
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('Authorization', 'Basic ' + Buffer.from(co.bitcoinUser + ":" + co.bitcoinPassword).toString('base64'));
        req.write(content);
        req.end();
    });
};