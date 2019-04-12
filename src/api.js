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
	const { url, shards: shardCount } = await app.locals.bucket.request("getGateway");

	if(options.force || Math.round(app.locals.shardCount * options.scaleAt) <= shardCount) {
		reshard({ url, shardCount });
	}
}

module.exports = async (redis, bucket) => {
	app.locals.bucket = bucket;
	app.locals.redis = redis;
	k8s = await kubernetes();

	app.locals.sharding = {
		shardCount: 0,
		shardsAvailable: [],
		gatewayURL: null,
		waiting: new Map(),
		lastStart: -1,
		available: false
	};

	await reshardCheck({ force: true });
};

setInterval(async () => {
	await reshardCheck({ scaleAt: 1.25 });
}, (1000 * 60) * 30);

async function reshard({ url, shardCount }) {
	if(app.locals.sharding.shardCount !== 0) await k8s.scale(0);
	const replicas = Math.max(Math.ceil(shardCount / +process.env.SHARDS_PER_SHARDER), 1);
	await k8s.scale(replicas);

	app.locals.sharding = {
		shardCount,
		shardsAvailable: Array.from({ length: shardCount }, (value, i) => i),
		gatewayURL: url,
		waiting: new Map(),
		lastStart: -1,
		available: true
	};

	await app.locals.redis.set("shards", shardCount);
	await app.locals.redis.set("replicas", replicas);
}

app.get("shards", async (req, res) => {
	const sharding = req.app.locals.sharding;
	if(sharding.available) {
		const shards = await req.app.locals.redis.get(`pod:${req.query.hostname}`) ||
			sharding.splice(0, +process.env.SHARDS_PER_SHARDER);
		sharding.lastStart = Date.now();
		sharding.available = false;

		res.status(200).json({
			shard_count: sharding.shardCount,
			shards,
			url: sharding.gatewayURL
		});

		sharding.waiting.delete(req.query.hostname);
		await req.app.locals.redis.set(`pod:${req.query.hostname}`, shards);
	} else {
		sharding.waiting.set(req.query.hostname, true);
		res.status(429).json({
			retry_at: sharding.lastStart + ((6000 * +process.env.SHARDS_PER_SHARDER) * (sharding.waiting.size + 1)),
			waiting: sharding.waiting.size
		});
	}
});

app.put("finished", async (req, res) => {
	const sharding = req.app.locals.sharding;
	sharding.available = true;

	res.status(204).end();
});

app.all("*", (req, res) => {
	res.status(404).json({ error: "Method not found" });
});

app.listen(process.env.SHARD_ORCHESTRATOR_SERVICE_PORT);
