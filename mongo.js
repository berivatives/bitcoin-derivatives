const {MongoClient} = require('mongodb'),
    cluster = require('cluster'),
    co = require('./constants'),
    w = require('./words'),
    db = {};

(async () => {
    for (let i in co.mongoClusters) {
        if (co.mongoClusters[i].length === 1) {
            db[i] = db[co.mongoClusters[i]];
            continue;
        }
        const client = await MongoClient.connect(co.mongoClusters[i], {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000
        }).catch(() => process.exit(0));
        db[i] = await client.db(co.dbName);
        if (cluster.isMaster) {
            await checkIndex(db[i], w.users, w.email, i);
            await checkIndex(db[i], w.deposits, w.data, i);
        }
    }
})();

async function checkIndex(db, collection, prop) {
    const exist = await db.listCollections({name: collection}).toArray();
    if (!exist.length) await db.createCollection(collection);
    if ((await db.collection(collection).indexes()).length < 2) {
        await db.collection(collection).insertOne({[prop]: "test"});
        await db.createIndex(collection, prop, {unique: true});
    }
}

module.exports = db;
