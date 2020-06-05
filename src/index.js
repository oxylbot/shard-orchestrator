const path = require("path");
const protobuf = require("protobufjs");

const BucketClient = require("./BucketClient");
const bucketClient = new BucketClient();

async function init() {
	const rpcProto = await protobuf.load(path.resolve(__dirname, "..", "protobuf", "rpcWrapper.proto"));
	const discordProto = await protobuf.load(path.resolve(__dirname, "..", "protobuf", "discordapi", "service.proto"));
	bucketClient.start({
		discord: discordProto,
		rpc: rpcProto
	});

	require("./api")(bucketClient);
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
