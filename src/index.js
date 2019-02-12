const path = require("path");
const protobuf = require("protobufjs");

const Redis = require("ioredis");
const redis = new Redis({
	port: process.env.REDIS_SERVICE_PORT_DEALER,
	host: "redis",
	family: 4,
	db: +process.env.REDIS_DATABASE,
	maxRetriesPerRequest: null,
	reconnectOnError(error) {
		return error.message.startsWith("connect ETIMEDOUT");
	}
});

const BucketClient = require("./BucketClient");
const bucketClient = new BucketClient();

async function init() {
	const rpcProto = await protobuf.load(path.resolve(__dirname, "..", "protobuf", "rpcWrapper.proto"));
	const discordProto = await protobuf.load(path.resolve(__dirname, "..", "protobuf", "discordapi", "service.proto"));
	bucketClient.start({
		discord: discordProto,
		rpc: rpcProto
	});

	require("./api")(redis, bucketClient);
}

init();

process.on("unhandledRejection", err => {
	console.error(err.stack);

	process.exit(1);
});

process.on("SIGTERM", () => {
	bucketClient.close();

	process.exit(0);
});
