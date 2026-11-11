import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Parser } from "tar";
import type { EastIndiaClient } from "../../src/eastindia-client.js";
import type { PurposeDetail } from "../../src/contract/purposes.js";
import { FakeService, type ReceivedRequest } from "../support/fake-service.js";

const fleetName = "sdk-node-lab";
const model = { name: fleetName, services: { lab: { image: "eastindia/development:latest" } } };
const stored: PurposeDetail = { title: "Nightly UI run", detail: "# Notes", setBy: "client", set: "2026-11-04T09:00:00.1234567Z" };
const operation = { id: "0f3c9a1d2b4e4f6a8c7d5e3b1a9f2c4d", kind: "fleet.up", target: fleetName, state: "queued", step: null, created: "2026-11-04T09:00:00.0000000Z", caller: "sdk-node", result: null, error: null };

/** The files of a tar archive held in memory, each by its name with its text. */
async function filesOf(body: Buffer): Promise<Record<string, string>> {
	const files: Record<string, string> = {};
	const parser = new Parser({
		onReadEntry: (entry) => {
			const chunks: Buffer[] = [];
			entry.on("data", (chunk: Buffer) => chunks.push(chunk));
			entry.on("end", () => {
				files[entry.path] = Buffer.concat(chunks).toString("utf8");
			});
		},
	});
	const done = new Promise<void>((resolve) => parser.on("end", resolve));
	parser.end(body);
	await done;
	return files;
}

describe("purposes", () => {
	let service: FakeService;
	let client: EastIndiaClient;

	beforeEach(async () => {
		service = await FakeService.overHttps();
		client = service.client();
	});

	afterEach(async () => {
		client.close();
		await service.close();
	});

	function only(method: string, pathname: string): ReceivedRequest {
		const matching = service.requests.filter((request) => request.method === method && request.url.split("?")[0] === pathname);
		assert.equal(matching.length, 1);
		return matching[0] as ReceivedRequest;
	}

	// Examples of use

	it("up_PurposeAndDetail_SendsThemAsPurposeJsonBesideTheModel", async () => {
		service.json("PUT", `/v1/fleets/${fleetName}`, 202, operation);

		await client.fleets.up(model, { purpose: "Nightly UI run", purposeDetail: "# Notes\nCafé\n" });

		const files = await filesOf(only("PUT", `/v1/fleets/${fleetName}`).body);
		assert.deepEqual(Object.keys(files).sort(), ["compose.json", "purpose.json"]);
		assert.deepEqual(JSON.parse(files["purpose.json"] ?? ""), { title: "Nightly UI run", detail: "# Notes\nCafé\n" });
	});

	it("up_TitleOnly_SendsPurposeJsonWithoutADetail", async () => {
		service.json("PUT", `/v1/fleets/${fleetName}`, 202, operation);

		await client.fleets.up(model, { purpose: "Nightly UI run" });

		const files = await filesOf(only("PUT", `/v1/fleets/${fleetName}`).body);
		assert.deepEqual(JSON.parse(files["purpose.json"] ?? ""), { title: "Nightly UI run" });
	});

	it("up_NoPurpose_SendsNoPurposeJson", async () => {
		service.json("PUT", `/v1/fleets/${fleetName}`, 202, operation);

		await client.fleets.up(model);

		assert.deepEqual(Object.keys(await filesOf(only("PUT", `/v1/fleets/${fleetName}`).body)), ["compose.json"]);
	});

	it("setPurpose_OnAMachine_PutsTitleAndDetailAndGivesTheStoredPurpose", async () => {
		service.json("PUT", "/v1/machines/lab-1/purpose", 200, { purpose: stored, effective: stored, purposeSource: "machine" });

		const result = await client.machines.setPurpose("lab-1", "Nightly UI run", { detail: "# Notes" });

		assert.deepEqual(JSON.parse(only("PUT", "/v1/machines/lab-1/purpose").body.toString("utf8")), { title: "Nightly UI run", detail: "# Notes" });
		assert.equal(result.purpose?.setBy, "client");
		assert.equal(result.purposeSource, "machine");
	});

	it("clearPurpose_OnAFleet_DeletesItAndGivesNoPurpose", async () => {
		service.json("DELETE", `/v1/fleets/${fleetName}/purpose`, 200, { purpose: null });

		const result = await client.fleets.clearPurpose(fleetName);

		assert.equal(result.purpose, null);
		only("DELETE", `/v1/fleets/${fleetName}/purpose`);
	});

	it("purpose_OnAFleet_GivesThePurposeAndItsHistory", async () => {
		const history = [
			{ time: "2026-11-04T09:00:00.0000000Z", action: "set", title: "Nightly UI run", detail: null, setBy: "client" },
			{ time: "2026-11-04T10:00:00.0000000Z", action: "cleared", title: null, detail: null, setBy: "npipe:LAB\\ann" },
		];
		service.json("GET", `/v1/fleets/${fleetName}/purpose`, 200, { purpose: null, history });

		const shown = await client.fleets.purpose(fleetName);

		assert.equal(shown.purpose, null);
		assert.deepEqual(shown.history.map((entry) => entry.action), ["set", "cleared"]);
	});

	it("purpose_OnAMachineWithoutOneOfItsOwn_NamesTheFleetAsTheSourceOfTheEffectivePurpose", async () => {
		service.json("GET", "/v1/machines/lab-1/purpose", 200, { purpose: null, history: [], effective: stored, purposeSource: "fleet" });

		const shown = await client.machines.purpose("lab-1");

		assert.equal(shown.purpose, null);
		assert.equal(shown.effective?.detail, "# Notes");
		assert.equal(shown.purposeSource, "fleet");
	});

	// Records

	it("list_MachineAndFleetRecords_CarryThePurposeTheServiceReturns", async () => {
		const summary = { title: "Nightly UI run", setBy: "client", set: "2026-11-04T09:00:00.1234567Z" };
		service.json("GET", "/v1/fleets", 200, [{ name: fleetName, status: "running(1)", configFiles: [], purpose: summary }]);

		const [listed] = await client.fleets.list();

		assert.deepEqual(listed?.purpose, summary);
	});

	// Examples of misuse

	it("up_DetailWithoutATitle_IsRefusedBeforeAnythingIsSent", async () => {
		await assert.rejects(client.fleets.up(model, { purposeDetail: "# Notes" }), /purposeDetail needs purpose/u);

		assert.equal(service.requests.length, 0);
	});

	it("up_TitleWithALineBreak_IsRefusedBeforeAnythingIsSent", async () => {
		for (const title of ["two\nlines", "two\rlines", "next\u0085line", "line\u2028separator", "paragraph\u2029separator"]) {
			await assert.rejects(client.fleets.up(model, { purpose: title }), /one line/u);
			await assert.rejects(client.machines.setPurpose("lab-1", title), /one line/u);
		}

		assert.equal(service.requests.length, 0);
	});

	it("up_PurposeWithAPackedArchive_IsRefusedBeforeAnythingIsSent", async () => {
		await assert.rejects(client.fleets.up({ name: fleetName, archive: new Uint8Array() }, { purpose: "Nightly UI run" }), /packed archive/u);

		assert.equal(service.requests.length, 0);
	});

	it("setPurpose_DetailOver64KiBInUtf8_IsRefusedButExactly64KiBIsSent", async () => {
		service.json("PUT", "/v1/fleets/lab/purpose", 200, { purpose: stored });
		const twoBytesEach = "é".repeat(65536 / 2);

		await client.fleets.setPurpose("lab", "Run", { detail: twoBytesEach });
		await assert.rejects(client.fleets.setPurpose("lab", "Run", { detail: `${twoBytesEach}x` }), /65536 bytes/u);

		assert.equal(service.requests.length, 1);
	});
});
