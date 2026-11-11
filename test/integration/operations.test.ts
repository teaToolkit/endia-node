import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, it } from "node:test";
import { create, list } from "tar";
import type { BuildResult, BuildStageResult } from "../../src/contract/images.js";
import type { Operation } from "../../src/contract/operations.js";
import type { BuildCacheUsage, BuilderPruneResult, DiskUsage, PruneResult } from "../../src/contract/space.js";
import { EastIndiaApiError } from "../../src/errors.js";
import type { EastIndiaClient } from "../../src/eastindia-client.js";
import { FakeService, type ReceivedRequest } from "../support/fake-service.js";

const operationId = "3f2a9c0d7e5b4a1c9d8e7f6a5b4c3d2e";

/** An operation as the service answers it, in a state and with a result or an error. */
function operation(state: string, extra: Partial<Operation> = {}): Operation {
	return { id: operationId, kind: "build", target: "lab/dotnet:10", state, step: null, created: "2026-11-02T21:00:00.0000000Z", caller: "sdk-node-tests", result: null, error: null, ...extra };
}

/** The names of the entries of a tar archive a request carried. */
async function entriesOf(request: ReceivedRequest | undefined): Promise<string[]> {
	const names: string[] = [];
	await new Promise<void>((resolve, reject) => {
		Readable.from([request?.body ?? Buffer.alloc(0)]).pipe(list({ onReadEntry: (entry) => names.push(entry.path) })).on("finish", resolve).on("error", reject);
	});
	return names;
}

describe("long work and its archives", () => {
	let service: FakeService | undefined;
	let client: EastIndiaClient | undefined;
	let folder: string;

	beforeEach(() => {
		folder = mkdtempSync(path.join(tmpdir(), "eastindia-client-operations-"));
	});

	afterEach(async () => {
		client?.close();
		await service?.close();
		rmSync(folder, { recursive: true, force: true });
		service = undefined;
		client = undefined;
	});

	it("build_FromAFolder_SendsThePackedContextWithDockersQueryAndWaitsForTheResult", async () => {
		mkdirSync(path.join(folder, "publish"));
		writeFileSync(path.join(folder, "Dockerfile"), "FROM eastindia/development:latest\nCOPY publish/ C:/ledger/\n");
		writeFileSync(path.join(folder, "publish", "Ledger.exe"), "MZ");
		const result = { digest: "sha256:0a", tags: ["lab/ledger:1"], buildKey: "sha256:0b", cacheHit: false, seconds: 61.5 };
		let reads = 0;
		service = (await FakeService.overHttps())
			.json("POST", "/v1/images/build", 202, operation("queued"))
			.on("GET", `/v1/operations/${operationId}/log`, (_received, response) => {
				response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end("Step 1/2 : FROM eastindia/development:latest\nSuccessfully built 0a\n");
			})
			.on("GET", `/v1/operations/${operationId}`, (_received, response) => {
				reads++;
				response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(operation("succeeded", { result })));
			});
		client = service.client();

		const build = await client.images.build({ folder }, { tags: ["lab/ledger:1"], buildArgs: { DOTNET_VERSION: "10.0.3" }, memory: 4294967296 });
		const log: string[] = [];
		assert.deepEqual(await build.result({ onLog: (text) => log.push(text) }), result);

		const sent = service.requests[0];
		const query = new URL(sent?.url ?? "", "https://fake").searchParams;
		assert.deepEqual([...query.keys()], ["t", "dockerfile", "buildargs", "memory"]);
		assert.equal(query.get("buildargs"), JSON.stringify({ DOTNET_VERSION: "10.0.3" }));
		assert.equal(sent?.headers["content-type"], "application/x-tar");
		assert.deepEqual(await entriesOf(sent), ["Dockerfile", "publish/", "publish/Ledger.exe"]);
		assert.equal(log.join(""), "Step 1/2 : FROM eastindia/development:latest\nSuccessfully built 0a\n");
		assert.equal(reads, 1);
	});

	it("wait_LogStreamEndsBeforeTheOperationFinishes_FollowsAgainAndDeliversEachPieceOnce", async () => {
		const states = ["running", "succeeded"];
		const logs = ["Step 1/2 : FROM base\n", "Step 1/2 : FROM base\nStep 2/2 : RUN setup.cmd\n"];
		service = (await FakeService.overHttps())
			.on("GET", `/v1/operations/${operationId}/log`, (_received, response) => {
				response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end(logs.shift());
			})
			.on("GET", `/v1/operations/${operationId}`, (_received, response) => {
				response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(operation(states.shift() ?? "succeeded")));
			});
		client = service.client();

		const log: string[] = [];
		const finished = await client.operations.handle(operation("running")).wait({ onLog: (text) => log.push(text) });

		assert.equal(finished.state, "succeeded");
		assert.equal(log.join(""), "Step 1/2 : FROM base\nStep 2/2 : RUN setup.cmd\n");
	});

	it("result_FailedBuild_IsEastIndiaApiErrorWithTheOperationsErrorCode", async () => {
		const failed = operation("failed", { error: { code: "BUILD_FAILED", message: "Step 2/2 exited with 1.", fieldPath: "Dockerfile:2:1", details: { line: 2, exitCode: 1, lastLines: [] } } });
		service = (await FakeService.overHttps())
			.on("GET", `/v1/operations/${operationId}/log`, (_received, response) => {
				response.writeHead(200).end();
			})
			.json("GET", `/v1/operations/${operationId}`, 200, failed);
		client = service.client();

		await assert.rejects(client.operations.handle(operation("running")).result(), (error: unknown) => {
			assert.ok(error instanceof EastIndiaApiError);
			assert.equal(error.status, undefined);
			assert.equal(error.code, "BUILD_FAILED");
			assert.equal(error.fieldPath, "Dockerfile:2:1");
			assert.equal(error.operation?.id, operationId);
			return true;
		});
	});

	it("fleetUp_FromTheResolvedModel_SendsTheArchiveWithComposeUpsQuery", async () => {
		writeFileSync(path.join(folder, "settings.json"), "{}");
		const model = JSON.stringify({ name: "shop", services: { web: { image: "eastindia/development:latest", volumes: [{ type: "bind", source: path.join(folder, "settings.json"), target: "C:/settings.json" }] } } }, null, 2);
		service = (await FakeService.overHttps()).json("PUT", "/v1/fleets/shop", 202, operation("queued", { kind: "fleetUp", target: "shop" }));
		client = service.client();

		const up = await client.fleets.up(model, { services: ["web"], build: "never", removeOrphans: true });

		assert.equal(up.accepted.kind, "fleetUp");
		const sent = service.requests[0];
		assert.equal(new URL(sent?.url ?? "", "https://fake").search, "?services=web&build=never&removeOrphans=true");
		assert.deepEqual(await entriesOf(sent), ["compose.json", "binds/web/0"]);
	});

	it("copyInAndOut_ThroughTheArchiveRoutes_CarryTheFileUnderItsOwnName", async () => {
		writeFileSync(path.join(folder, "seed.csv"), "id,name\n1,Ada\n");
		const stat = Buffer.from(JSON.stringify({ name: "report.txt", size: 6, mode: "file", mtime: "2026-11-02T21:00:00.0000000Z", linkTarget: null })).toString("base64");
		const report = await new Promise<Buffer>((resolve) => {
			writeFileSync(path.join(folder, "report.txt"), "passed");
			const chunks: Buffer[] = [];
			create({ cwd: folder }, ["report.txt"]).on("data", (chunk: Buffer) => chunks.push(chunk)).on("end", () => {
				resolve(Buffer.concat(chunks));
			});
		});
		rmSync(path.join(folder, "report.txt"));
		service = (await FakeService.overHttps())
			.on("PUT", "/v1/machines/shop-web-1/archive", (_received, response) => {
				response.writeHead(200).end();
			})
			.on("GET", "/v1/machines/shop-web-1/archive", (_received, response) => {
				response.writeHead(200, { "Content-Type": "application/x-tar", "X-EastIndia-Path-Stat": stat }).end(report);
			});
		client = service.client();

		await client.archives.copyIn("shop-web-1", path.join(folder, "seed.csv"), "C:/data");
		const out = path.join(folder, "out");
		const described = await client.archives.copyOut("shop-web-1", "C:/results/report.txt", out);

		assert.equal(new URL(service.requests[0]?.url ?? "", "https://fake").searchParams.get("path"), "C:/data");
		assert.deepEqual(await entriesOf(service.requests[0]), ["seed.csv"]);
		assert.equal(described.size, 6);
		assert.equal(readFileSync(path.join(out, "report.txt"), "utf8"), "passed");
	});

	it("build_WithATarget_SendsTheStageNameAndGivesWhatEachStageGave", async () => {
		writeFileSync(path.join(folder, "Endiafile"), "FROM eastindia/development:latest AS tools\nRUN setup.cmd\n\nFROM tools AS app\nRUN app.cmd\n");
		const stages: BuildStageResult[] = [{ name: "tools", digest: "sha256:0a", buildKey: "sha256:0b", cacheHit: true }];
		const result: BuildResult = { digest: "sha256:0a", tags: ["lab/tools:1"], buildKey: "sha256:0b", cacheHit: true, seconds: 0.4, stages };
		service = finishing(await FakeService.overHttps(), result).json("POST", "/v1/images/build", 202, operation("queued"));
		client = service.client();

		const built = await (await client.images.build({ folder }, { target: "tools", tags: ["lab/tools:1"] })).result();

		const query = new URL(service.requests[0]?.url ?? "", "https://fake").searchParams;
		assert.deepEqual(query.getAll("target"), ["tools"]);
		assert.deepEqual(built.stages, stages);
	});

	it("build_WithoutATarget_SendsNoTargetParameter", async () => {
		service = finishing(await FakeService.overHttps(), { digest: "sha256:0a", tags: [], buildKey: "sha256:0b", cacheHit: false, seconds: 1 })
			.json("POST", "/v1/images/build", 202, operation("queued"));
		client = service.client();

		await (await client.images.build({ archive: new Uint8Array(1024), recipe: "Endiafile" })).result();

		const query = new URL(service.requests[0]?.url ?? "", "https://fake").searchParams;
		assert.equal(query.has("target"), false);
	});

	it("pruneBuildCache_WithAll_PostsToBuilderPruneAndGivesTheEntriesDeleted", async () => {
		const result: BuilderPruneResult = { deletedBuildCache: ["sha256:0a"], reclaimedBytes: 7340032 };
		service = finishing(await FakeService.overHttps(), result).json("POST", "/v1/builder/prune", 202, operation("queued", { kind: "builderPrune", target: "builder" }));
		client = service.client();

		const prune = await client.images.pruneBuildCache({ all: true });

		assert.equal(prune.accepted.kind, "builderPrune");
		assert.deepEqual(await prune.result(), result);
		const sent = service.requests[0];
		assert.ok(sent);
		const url = new URL(sent.url, "https://fake");
		assert.equal(`${sent.method} ${url.pathname}${url.search}`, "POST /v1/builder/prune?all=true");
		assert.ok(sent.headers["idempotency-key"]);
	});

	it("systemPrune_Finished_GivesTheBuildCacheEntriesDeleted", async () => {
		const result: PruneResult = { deletedMachines: [], deletedImages: [], deletedBuildCache: ["sha256:0a"], deletedVolumes: [], deletedOperations: 0, deletedOrphans: [], reclaimedBytes: 7340032 };
		service = finishing(await FakeService.overHttps(), result).json("POST", "/v1/system/prune", 202, operation("queued", { kind: "systemPrune", target: "system" }));
		client = service.client();

		const pruned = await (await client.system.prune()).result();

		assert.deepEqual(pruned.deletedBuildCache, ["sha256:0a"]);
	});

	it("diskUsage_ListsEachBuildCacheEntry", async () => {
		const entry: BuildCacheUsage = { id: "sha256:0a", parentId: "sha256:0c", created: "2026-11-10T09:00:00.0000000Z", lastUsed: "2026-11-10T10:00:00.0000000Z", sizeBytes: 7340032, inUse: false, reclaimable: true };
		const usage: DiskUsage = {
			images: [],
			machines: [],
			volumes: [],
			buildCache: [entry],
			imageFolder: { path: "M:\\EastIndia", freeBytes: 1, capacityBytes: 2, reserveBytes: 0 },
			storageRoot: { path: "C:\\ProgramData\\EastIndia", sizeBytes: 1, freeBytes: 1 },
		};
		service = (await FakeService.overHttps()).json("GET", "/v1/system/df", 200, usage);
		client = service.client();

		assert.deepEqual((await client.system.diskUsage()).buildCache, [entry]);
	});
});

/** Answers the operation's log and record as a finished, succeeded operation with this result. */
function finishing(service: FakeService, result: unknown): FakeService {
	return service
		.on("GET", `/v1/operations/${operationId}/log`, (_received, response) => {
			response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end();
		})
		.json("GET", `/v1/operations/${operationId}`, 200, operation("succeeded", { result }));
}
