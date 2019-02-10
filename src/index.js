const path = require("path");
const protobuf = require("protobufjs");

const Redis = require("ioredis");
const redis = new Redis({
	port: +process.env.REDIS_PORT,
	host: process.env.REDIS_HOST,
	family: 4,
	db: +process.env.REDIS_DATABASE
});

const BucketClient = require("./BucketClient");
const bucketClient = new BucketClient(process.env.BUCKET_SOCKET_ADDRESS);

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
