const Client = require("kubernetes-client").Client;

module.exports = async () => {
	const client = new Client();
	await client.loadSpec();

	let replicaCount = 0;
	return {
		async scale(replicas) {
			for(let i = replicaCount; i < replicas; i++) await module.exports.createService(i);
			replicaCount = replicas;

			await client.apis.apps.v1
				.namespaces(process.env.NAMESPACE)
				.statefulsets("sharder")
				.patch({ body: { spec: { replicas } } });

			return Promise.resolve();
		},
		async createSharderService(target) {
			const app = `sharder-${target}`;

			await client.api.v1
				.namespaces(process.env.NAMESPACE)
				.services
				.post({
					body: {
						apiVersion: "v1",
						kind: "Service",
						meta: {
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
};
