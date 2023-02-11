const fs = require('fs'),
    w = require('./words'),
    router = {};

router[w.noUserCheck] = {};
router[w.files] = {};

module.exports = router;

function loadFiles(path, module) {
    try {
        const files = fs.readdirSync(path);
        for (let f of files) {
            if (fs.lstatSync(path + f).isDirectory()) {
                loadFiles(path + f + "/", module);
            } else {
                const data = fs.readFileSync(path + f);
                if (module) {
                    const code = data.toString().toLowerCase().replace(/\n/gi, '').replace(/ /gi, '');
                    if (code.includes('router=require')) {
                        require('./' + path + f);
                    }
                } else {
                    if (f === "index.html" && path.includes("unstable")) f = "unstable.html";
                    if (!router[w.files][f]) router[w.files][f] = data;
                }
            }
        }
    } catch (e) {

    }
}

loadFiles('services/', true);
router[w.files][w.loadFiles] = () => {
    router[w.files] = {};
    loadFiles('public/');
};
router[w.files][w.loadFiles]();