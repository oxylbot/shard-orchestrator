const path = require("path");
const protobuf = require("protobufjs");

const BucketClient = require("./BucketClient");

const bucketClient = new BucketClient(process.env.BUCKET_SOCKET_ADDRESS);

async function init() {
	const rpcProto = await protobuf.load(path.resolve(__dirname, "..", "protobuf", "rpcWrapper.proto"));
	const discordProto = await protobuf.load(path.resolve(__dirname, "..", "protobuf", "discordapi", "service.proto"));
	bucketClient.start({
		discord: discordProto,
		rpc: rpcProto
	});

	require("./shardManager")(bucketClient);
}

init();

process.on("SIGTERM", () => {
	bucketClient.close();

	process.exit(0);
});
