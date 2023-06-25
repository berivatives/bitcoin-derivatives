const co = require('../constants');

module.exports = async function (method, params, hostname, port) {
    const body = JSON.stringify({method, params});
    return fetch("http://" + (hostname || co.bitcoinIP) + ":" + (port || co.bitcoinPort) + "/", {
        method: 'POST',
        body,
        headers: {
            'Authorization': 'Basic ' + Buffer.from(co.bitcoinUser + ":" + co.bitcoinPassword).toString('base64'),
            'Content-type': 'application/json; charset=UTF-8'
        },
    }).then((response) => response.json()).then(json => {
        json.code = json.error ? json.error.code : 0;
        return json;
    }).catch(() => {
        return {code: -1};
    });
};