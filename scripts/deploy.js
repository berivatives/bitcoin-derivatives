const {strictEqual} = require('assert'),
    fs = require('fs'),
    {osCommand} = require("../utilities/commons");

async function tests() {
    const files = fs.readdirSync("../tests").filter(f => f.startsWith("Test") && f.endsWith(".js"));
    for (const file of files) {
        const content = fs.readFileSync("../tests/" + file).toString();
        if (content.indexOf('process') !== content.lastIndexOf('process')) {
            console.log(file, 'multiple process.exit');
            strictEqual(true, false);
        }
        const {code, result} = await osCommand("node", ["../tests/" + file], true);
        console.log(file, result);
        strictEqual(code, 0);
    }
}

(async () => {
    strictEqual((await osCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"])).result, "main\n");
    await tests();
    const {machines} = JSON.parse("" + fs.readFileSync("../../secrets.json"));
    const commitHash = await osCommand("git", ["rev-parse", "HEAD"]);
    for (let c in machines) {
        for (const ip of machines[c]) {
            const {code} = await osCommand("ssh", [ip, "cd $HOME/back; node scripts/maintenance.js; git pull; npm i; sudo systemctl restart nodejs-daemon.service;"]);
            const {result} = await osCommand("ssh", [ip, "cd $HOME/back; git rev-parse HEAD;"]);
            strictEqual(code, 0);
            strictEqual(result, commitHash.result);
        }
    }
    process.exit(0);
})();