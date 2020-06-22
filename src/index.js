const logger = require("./logger");
const path = require("path");
const protobuf = require("protobufjs");

const BucketClient = require("./BucketClient");
const bucketClient = new BucketClient();

async function init() {
	const rpcProto = await protobuf.load(path.resolve(__dirname, "..", "bucket-proto", "rpcWrapper.proto"));
	logger.info("Loaded bucket RPC prototype");
	const discordProto = await protobuf.load(path.resolve(__dirname, "..", "bucket-proto", "service.proto"));
	logger.info("Loaded bucket discord prototype");
	bucketClient.start({
		discord: discordProto,
		rpc: rpcProto
	});
	logger.info("Started bucket socket");

	require("./rest")(bucketClient);
}

init();

process.on("unhandledRejection", error => {
	logger.error(error.stack, { error });

	process.exit(1);
});

process.on("SIGTERM", () => {
	bucketClient.close();
	logger.info("Closing bucket socket due to SIGTERM");

	process.exit(0);
});
