const Client = require("kubernetes-client").Client;

module.exports = async () => {
	const client = new Client();
	await client.loadSpec();

	const statefulSet = await client.apis.apps.v1
		.namespaces(process.env.NAMESPACE)
		.statefulsets("sharder")
		.status
		.get();

	console.log("Stateful set", statefulSet);
	let serviceCount = statefulSet.body.status.replicas;
	console.log("Services created", serviceCount);

	const functions = {
		async scale(replicas) {
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
			console.log("Creating service for", app);

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
