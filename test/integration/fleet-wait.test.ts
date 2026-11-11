import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { FleetDetail } from "../../src/contract/fleets.js";
import type { MachineSummary } from "../../src/contract/machines.js";
import { MachineFailedError } from "../../src/errors.js";
import type { EastIndiaClient } from "../../src/eastindia-client.js";
import { FakeService } from "../support/fake-service.js";

const fleetName = "sdk-node-lab";
const model = {
	name: fleetName,
	services: {
		server: { image: "eastindia/development:latest" },
		client: { image: "eastindia/development:latest", depends_on: { server: { condition: "service_healthy" } } },
		spare: { image: "eastindia/development:latest" },
	},
};

/** A machine as the fleet lists it, running, ready and without a health check unless the test says otherwise. */
function machine(service: string, extra: Partial<MachineSummary> = {}): MachineSummary {
	return {
		id: "0".repeat(32),
		name: `${fleetName}-${service}-1`,
		fleet: fleetName,
		service,
		index: 1,
		image: "eastindia/development:latest",
		imageDigest: `sha256:${"c".repeat(64)}`,
		command: "",
		created: "2026-11-04T09:00:00.0000000Z",
		state: "running",
		status: "Up 1 minute",
		exitCode: null,
		ready: true,
		health: "none",
		ports: [],
		purpose: null,
		purposeSource: null,
		...extra,
	};
}

/** The fleet with its machines, as `compose ps` reads it. */
function fleet(...machines: MachineSummary[]): FleetDetail {
	return { name: fleetName, configFiles: [], projectDirectory: "/lab", model, networks: [], volumes: [], machines, created: "2026-11-04T09:00:00.0000000Z", updated: "2026-11-04T09:00:00.0000000Z", purpose: null };
}

describe("waiting for a fleet", () => {
	let service: FakeService | undefined;
	let client: EastIndiaClient | undefined;

	afterEach(async () => {
		client?.close();
		await service?.close();
		service = undefined;
		client = undefined;
	});

	/** Answers each read of the fleet with the next answer, and keeps giving the last. */
	async function serve(...answers: FleetDetail[]): Promise<{ client: EastIndiaClient; reads: () => number }> {
		let reads = 0;
		const fake = await FakeService.overHttps();
		service = fake.on("GET", `/v1/fleets/${fleetName}`, (_received, response) => {
			const answer = answers[Math.min(reads, answers.length - 1)];
			reads++;
			response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(answer));
		});
		const opened = fake.client();
		client = opened;
		return { client: opened, reads: () => reads };
	}

	it("wait_SelectedServiceAndItsDependencyBecomeHealthy_GivesTheirMachines", async () => {
		const { client: eastindia, reads } = await serve(
			fleet(machine("server", { health: "starting" }), machine("client"), machine("spare", { ready: false })),
			fleet(machine("server", { health: "healthy" }), machine("client"), machine("spare", { ready: false })),
		);

		const machines = await eastindia.fleets.wait(fleetName, { services: ["client"], timeout: 30 });

		assert.deepEqual(machines.map((each) => each.service).sort(), ["client", "server"]);
		assert.equal(reads(), 2);
	});

	it("wait_MachineExited_ThrowsMachineFailedError", async () => {
		const { client: eastindia } = await serve(fleet(machine("server", { state: "exited", ready: false, exitCode: 3 }), machine("client"), machine("spare")));

		await assert.rejects(eastindia.fleets.wait(fleetName), (error: unknown) => error instanceof MachineFailedError && error.message === `machine ${fleetName}-server-1 is exited (3)` && error.machine.service === "server");
	});

	it("wait_MachineUnhealthy_ThrowsMachineFailedError", async () => {
		const { client: eastindia } = await serve(fleet(machine("server", { health: "unhealthy" }), machine("client"), machine("spare")));

		await assert.rejects(eastindia.fleets.wait(fleetName), (error: unknown) => error instanceof MachineFailedError && error.message === `machine ${fleetName}-server-1 is unhealthy`);
	});

	it("wait_TimeOutPasses_ThrowsTimeoutError", async () => {
		const { client: eastindia } = await serve(fleet(machine("server", { ready: false }), machine("client"), machine("spare")));

		await assert.rejects(eastindia.fleets.wait(fleetName, { timeout: 0 }), (error: unknown) => error instanceof DOMException && error.name === "TimeoutError");
	});
});
