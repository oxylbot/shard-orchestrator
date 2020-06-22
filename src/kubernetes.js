const Client = require("kubernetes-client").Client;
const logger = require("./logger");

module.exports = async () => {
	const client = new Client();
	await client.loadSpec();

	const statefulSet = await client.apis.apps.v1
		.namespaces(process.env.NAMESPACE)
		.statefulsets("sharder")
		.status
		.get();

	let serviceCount = statefulSet.body.status.replicas;
	logger.info("Retrieved stateful set status", { statefulSet });

	const functions = {
		async scale(replicas) {
			logger.info(`Scaling sharder to ${replicas}`);
			for(let i = serviceCount; i < replicas; i++) await functions.createSharderService(i);

			await client.apis.apps.v1
				.namespaces(process.env.NAMESPACE)
				.statefulsets("sharder")
				.patch({ body: { spec: { replicas } } });

			return Promise.resolve();
		},
		async createSharderService(target) {
			const app = `sharder-${target}`;
			serviceCount++;
			logger.info(`Creating service for ${app}`);

			await client.api.v1
				.namespaces(process.env.NAMESPACE)
				.services
				.post({
					body: {
						apiVersion: "v1",
						kind: "Service",
						metadata: {
							name: app,
							namespace: process.env.NAMESPACE
						},
						spec: {
							selector: {
								"statefulset.kubernetes.io/pod-name": app
							},
							ports: [{
								name: "http",
								port: +process.env.SHARDER_API_PORT,
								protocol: "TCP"
							}]
						}
					}
				});
		}
	};

	return functions;
};
