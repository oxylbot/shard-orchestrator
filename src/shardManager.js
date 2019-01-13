const k8s = require("./kubernetes");
const Redis = require("ioredis");
const redis = new Redis({
	port: +process.env.REDIS_PORT,
	host: process.env.HOST,
	family: 4,
	db: +process.env.REDIS_DATABASE
});

module.exports = bucket => ({
	async checkShards() {
		const { url, shardCount: shards } = await bucket.request("GetGateway");

		const shards = Array.from(shardCount, (value, i) => i);
	}
});
