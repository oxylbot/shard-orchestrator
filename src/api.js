const express = require("express");
const kubernetes = require("./kubernetes");
let k8s;

const app = express();

app.enable("trust proxy");
app.disable("etag");
app.disable("x-powered-by");
app.set("env", process.env.NODE_ENV);

app.use(express.json());

async function reshardCheck(options = {}) {
	const { url, shards: shardCount, maxConcurrency } = await app.locals.bucket.request("getGateway");

	if(options.force || Math.round(app.locals.sharding.shardCount * options.scaleAt) <= shardCount) {
		reshard({ url, shardCount, maxConcurrency });
	}
}

module.exports = async (redis, bucket) => {
	app.locals.bucket = bucket;
	app.locals.redis = redis;
	k8s = await kubernetes();

	await reshardCheck({ force: true });
};

setInterval(async () => {
	await reshardCheck({ scaleAt: 1.25 });
}, (1000 * 60) * 30);

async function reshard({ url, shardCount, maxConcurrency }) {
	if(app.locals.sharding.shardCount !== 0) await k8s.scale(0);
	const replicas = Math.max(Math.ceil(shardCount / +process.env.SHARDS_PER_SHARDER), 1);
	await k8s.scale(replicas);

	app.locals.sharding = {
		shardCount,
		shardsAvailable: Array.from({ length: shardCount }, (value, i) => i),
		gatewayURL: url,
		waiting: new Map(),
		lastStart: -1,
		available: maxConcurrency,
		maxConcurrency
	};

	console.log("Resharded with", shardCount, "shards at", replicas, "replicas");
	await app.locals.redis.set("shards", shardCount);
	await app.locals.redis.set("replicas", replicas);
}

app.get("/shards", async (req, res) => {
	const sharding = req.app.locals.sharding;
	console.log(req.query.hostname, "is trying to get shards");
	console.log("Sharding", sharding);
	if(sharding.available > 0) {
		console.log("Shards are available");
		const cachedShards = await req.app.locals.redis.exists(`pod:${req.query.hostname}`);
		if(sharding.shardsAvailable.length === 0 && !cachedShards) {
			res.status(400).json({ error: "All shards are being used" });
			return;
		}

		const shards = cachedShards ?
			JSON.parse(await req.app.locals.redis.get(`pod:${req.query.hostname}`)) :
			sharding.shardsAvailable.splice(0, +process.env.SHARDS_PER_SHARDER);

		console.log("Shards to give", shards);
		sharding.lastStart = Date.now();
		sharding.available -= 1;

		res.status(200).json({
			shard_count: sharding.shardCount,
			shards,
			url: sharding.gatewayURL
		});

		sharding.waiting.delete(req.query.hostname);
		await req.app.locals.redis.set(`pod:${req.query.hostname}`, JSON.stringify(shards));
		setTimeout(() => sharding.available += 1, 5000);
	} else {
		sharding.waiting.set(req.query.hostname, true);
		console.log("Time to wait!");

		const extraTime = ((5000 / sharding.maxConcurrency) * +process.env.SHARDS_PER_SHARDER) *
							(sharding.waiting.size + 1);
		res.status(429).json({
			retry_at: sharding.lastStart + extraTime,
			waiting: sharding.waiting.size
		});
	}
});

app.all("*", (req, res) => {
	res.status(404).json({ error: "Method not found" });
});

app.listen(process.env.SHARD_ORCHESTRATOR_SERVICE_PORT);
