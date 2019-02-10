const express = require("express");
const k8s = require("./kubernetes");

const app = express();

app.enable("trust proxy");
app.disable("etag");
app.disable("x-powered-by");
app.set("env", process.env.NODE_ENV);

app.use(express.json());

async function reshardCheck(options = {}) {
	console.log("Reshard check", options);
	const { url, shards: shardCount } = await app.locals.bucket.request("getGateway");
	console.log("url", url);
	console.log("shard count", shardCount);

	if(options.force || Math.round(app.locals.shardCount * options.scaleAt) <= shardCount) {
		console.log("Calling reshard()");
		reshard({ url, shardCount });
	}
}

module.exports = async (redis, bucket) => {
	app.locals.bucket = bucket;
	app.locals.redis = redis;

	await reshardCheck({ force: true });
};

setInterval(async () => {
	await reshardCheck({ scaleAt: 1.25 });
}, (1000 * 60) * 30);

async function reshard({ url, shardCount }) {
	app.locals.sharding = {
		shardCount,
		shardsAvailable: Array.from({ length: shardCount }, (value, i) => i),
		gatewayURL: url,
		waiting: new Map(),
		lastStart: -1,
		available: true
	};

	await k8s.scale(0);
	const replicas = Math.max(Math.ceil(shardCount / +process.env.SHARDS_PER_SHARDER), 1);
	console.log("Scaling to", replicas);
	await k8s.scale(replicas);

	await app.locals.redis.set("shards", shardCount);
	await app.locals.redis.set("replicas", replicas);
}

app.get("shards", async (req, res) => {
	const sharding = req.app.locals.sharding;
	console.log(req.query.hostname, "asking for shards");
	if(sharding.available) {
		console.log("is available");
		const shards = await req.app.locals.redis.get(`pod:${req.query.hostname}`) ||
			sharding.splice(0, +process.env.SHARDS_PER_SHARDER);
		sharding.lastStart = Date.now();
		sharding.available = false;

		console.log("giving", shards);
		res.status(200).json({
			shard_count: sharding.shardCount,
			shards,
			url: sharding.gatewayURL
		});

		sharding.waiting.delete(req.query.hostname);
		await req.app.locals.redis.set(`pod:${req.query.hostname}`, shards);
	} else {
		console.log("must wait", (6000 * +process.env.SHARDS_PER_SHARDER) * (sharding.waiting.size + 1), "ms");
		sharding.waiting.set(req.query.hostname, true);
		res.status(429).json({
			retry_at: sharding.lastStart + ((6000 * +process.env.SHARDS_PER_SHARDER) * (sharding.waiting.size + 1)),
			waiting: sharding.waiting.size
		});
	}
});

app.put("finished", async (req, res) => {
	console.log("Sharder finished identifying", req.query, "available again");
	const sharding = req.app.locals.sharding;
	sharding.available = true;

	res.status(204).end();
});

app.all("*", (req, res) => {
	res.status(404).json({ error: "Method not found" });
});

app.listen(process.env.API_PORT);
