const Client = require("kubernetes-client").Client;
const config = require("kubernetes-client").config;

const namespace = {
	production: "oxyl",
	staging: "oxyl-staging",
	development: "oxyl-development"
}[process.env.NODE_ENV];

module.exports = async () => {
	const client = new Client({ config: config.getInCluster() });
	await client.loadSpec();

	return {
		async scale(replicas) {
			return await client.apis.apps.v1
				.namespaces(namespace)
				.statefulsets("sharder")
				.status
				.patch({ body: { spec: { replicas } } });
		}
	};
};
