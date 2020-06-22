const express = require("express");
const expressWinston = require("express-winston");
const kubernetes = require("./kubernetes");
const logger = require("../logger");
const superagent = require("superagent");
let k8s;

const app = express();

app.enable("trust proxy");
app.disable("etag");
app.disable("x-powered-by");
app.set("env", process.env.NODE_ENV);

app.use(express.json());
app.use(expressWinston.logger({ winstonInstance: logger }));

async function reshardCheck(options = {}) {
	const { url, shards: shardCount, maxConcurrency } = await app.locals.bucket.request("getGateway");

	if(options.force || Math.round(app.locals.sharding.shardCount * options.scaleAt) <= shardCount) {
		reshard({ url, shardCount, maxConcurrency });
	}
}

module.exports = async bucket => {
	app.locals.bucket = bucket;
	k8s = await kubernetes();

	await reshardCheck({ force: true });
};

setInterval(async () => {
	await reshardCheck({ scaleAt: 1.25 });
}, (1000 * 60) * 30);

async function reshard({ url, shardCount, maxConcurrency }) {
	if(app.locals.sharding && app.locals.sharding.shardCount !== 0) await k8s.scale(0);
	const replicas = Math.max(Math.ceil(shardCount / +process.env.SHARDS_PER_SHARDER), 1);
	await k8s.scale(replicas);

	app.locals.sharding = {
		shardCount,
		gatewayURL: url,
		waiting: new Map(),
		lastStart: -1,
		available: maxConcurrency,
		maxConcurrency
	};

	logger.info(`Resharded with ${shardCount} shards with ${replicas} replicas`);
}

app.get("/shards", async (req, res) => {
	const sharding = req.app.locals.sharding;
	logger.debug(`${req.query.hostname} is trying to get shards`);

	if(sharding.available > 0) {
		logger.debug(`Shards are available`);

		const sharderNumber = Number(req.query.hostname.split("-")[1]);

		const start = +process.env.SHARDS_PER_SHARDER * sharderNumber;
		let end = +process.env.SHARDS_PER_SHARDER * (sharderNumber + 1);
		if(end > sharding.shardCount) end = sharding.shardCount;
		const shards = Array.from({ length: end - start }, (val, i) => start + i);

		logger.debug(`Handing out ${shards}`);
		sharding.lastStart = Date.now();
		sharding.available -= 1;

		res.status(200).json({
			shard_count: sharding.shardCount,
			shards,
			url: sharding.gatewayURL
		});

		sharding.waiting.delete(req.query.hostname);
		setTimeout(() => sharding.available += 1, 5000);
	} else {
		sharding.waiting.set(req.query.hostname, true);

		const extraTime = ((5000 / sharding.maxConcurrency) * +process.env.SHARDS_PER_SHARDER) *
			(sharding.waiting.size + 1);

		logger.debug(`Ratelimiting for ${extraTime}`);
		res.status(429).json({
			retry_at: sharding.lastStart + extraTime,
			waiting: sharding.waiting.size
		});
	}
});

app.get("/request-guild-members", async (req, res) => {
	const sharding = req.app.locals.sharding;
	const shard = (req.query.id >> 22) % sharding.shardCount;
	const sharderNumber = Math.floor(shard / +process.env.SHARDS_PER_SHARDER);

	logger.verbose(`Requesting guild members from sharder-${sharderNumber}`);
	const result = await superagent
		.get(`http://sharder-${sharderNumber}:${process.env.SHARDER_API_PORT}/request-guild-members`)
		.query({
			id: req.query.id,
			query: req.query.query,
			userIds: req.query.userIds
		})
		.ok(() => true);

	logger.verbose("Requested guild members", { members: result });
	return res.status(result.status).json(result.body);
});

app.all("*", (req, res) => {
	res.status(404).json({ error: "Method not found" });
});

app.use(expressWinston.errorLogger({ winstonInstance: logger }));
app.listen(process.env.SHARD_ORCHESTRATOR_SERVICE_PORT, () => {
	logger.info(`REST API listening on port ${process.env.SHARD_ORCHESTRATOR_SERVICE_PORT}`);
});
