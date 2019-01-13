const Client = require("kubernetes-client").Client;
const config = require("kubernetes-client").config;

module.exports = async () => {
	const client = new Client({ config: config.getInCluster() });
	await client.loadSpec();

	const namespace = {
		PRODUCTION: "oxyl",
		STAGING: "oxyl-staging",
		DEVELOPMENT: "oxyl-development"
	}[process.env.NODE_ENV];

	return {
		async getSharders() {
			const sharders = await client.apis.apps.v1.namespaces(namespace).deployments("sharder").get();

			return sharders;
		}
	};
};
