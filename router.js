const fs = require('fs'),
    w = require('./words'),
    c = require('./constants'),
    router = {};

router[w.noUserCheck] = {};
router[w.files] = {};

module.exports = router;

function loadFiles(path, module, force) {
    try {
        const files = fs.readdirSync(path);
        for (let f of files) {
            if (fs.lstatSync(path + f).isDirectory()) {
                loadFiles(path + f + "/", module, force);
            } else {
                const data = fs.readFileSync(path + f);
                if (module) {
                    const code = data.toString().toLowerCase().replace(/\n/gi, '').replace(/ /gi, '');
                    if (code.includes('router=require')) {
                        require('./' + path + f);
                    }
                } else {
                    if (f === "index.html" && path.includes("unstable")) f = "unstable.html";
                    if (!router[w.files][f] || force) {
                        if (c.cache) router[w.files][f] = data;
                        else router[w.files][f] = () => fs.readFileSync(path + f);
                    }
                }
            }
        }
    } catch (e) {

    }
}

loadFiles('services/', true);

const index = c.__dirname + '/public/index.html';

function reload() {
    router[w.files] = {};
    router[w.files]['index.html'] = !c.cache ? () => fs.readFileSync(index) : fs.readFileSync(index);
    loadFiles('public/', false, true);
}

fs.watchFile(index, {interval: 1000}, () => reload());
reload();