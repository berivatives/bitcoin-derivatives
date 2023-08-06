# **Back-end of berivatives.com - an open source Bitcoin derivatives exchange**

**To start a dev server**

_Install &  start 3 redis instances from this fork https://github.com/berivatives/redis at port 6379, 6380 & 6381_

`redis-server --save "" --appendonly no`

`redis-server --save "" --appendonly no --port 6380`

`redis-server --save "" --appendonly no --port 6381`

_Start a mongodb instance at port 27017_

`mongod --dbpath /tmp --port 27017`

_Start a bitcoin daemon instance using proxy arg to block the blockchain download_

`bitcoind -proxy=127.0.0.1:15000 -rpcuser=dev -rpcpassword=dev -fallbackfee=0`

`npm install;`

`npm run dev;`

`node scripts/addMarket.js BTC "Bitcoin" 0`

`node scripts/addMarket.js BLX "Bitcoin Liquid Index" 6`

`node scripts/addMarket.js ETH "Ethereum" 6`

`node scripts/addMarket.js LTC "Litecoin" 6`