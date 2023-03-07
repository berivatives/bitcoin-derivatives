const redis = require('../redis'),
    mongo = require('../mongo'),
    w = require('../words'),
    {getCluster, wait} = require('../utilities/commons');

if (process.argv.length !== 3) {
    console.log(process.argv);
    console.log("argv problem need an email");
    // process.exit(-1);
}

// const email = process.argv[2];
const email = "1676558323329@mail.com";

(async () => {
    await wait(1000);
    const {value} = await mongo[getCluster(email)].collection(w.users).findOneAndUpdate({email}, {$set: {[w.referral]: true}}, {returnDocument: "after"});
    if (value) await redis[getCluster(email)][w.hsetAsync]("" + value[w.mongoId], w.referral, w.true);
    else console.log("no user with email", email);
    process.exit(0);
})();
