import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, describe, it } from "node:test";
import { resolveComposeModel } from "../../src/compose-model.js";
import type { MachineSummary } from "../../src/contract/machines.js";
import { connectionFromEnvironment } from "../../src/environment.js";
import { EastIndiaApiError, EastIndiaConnectionError } from "../../src/errors.js";
import { EastIndiaClient } from "../../src/eastindia-client.js";
import { tlsFile } from "../support/fake-service.js";

/**
 * These tests drive the real EastIndia service the CLI's current context names, and run only when EASTINDIA_LIVE=1. They resolve
 * the fleet's Compose file with the `endia` CLI, found as EASTINDIA_CLI or else on the PATH. Other callers
 * share the service, so the tests follow four rules:
 *
 * - every fleet, machine and image tag they create starts with `sdk-node-`;
 * - they run one machine at a time, from `eastindia/development:latest`, with 4 GiB of memory;
 * - they remove what they made, even when a test fails;
 * - they never remove, stop or prune anything else.
 */
const live = process.env["EASTINDIA_LIVE"] === "1";
const prefix = "sdk-node-";
const run = `${prefix}${Date.now().toString(36)}`;
const baseImage = "eastindia/development:latest";

/** The memory limit of the fleet's machine, 4 GiB, as a Compose file writes it. */
const machineMemory = "4g";

/** The longest wait for the machine to be running and ready. A machine on the owner's PC boots Windows well within it. */
const readyTimeoutMilliseconds = 15 * 60 * 1000;

/** How often the machine's state is read while waiting for it. */
const pollMilliseconds = 2000;

describe("the live service", { skip: live ? false : "set EASTINDIA_LIVE=1 to run the live tests against the CLI's current context", timeout: 60 * 60 * 1000 }, () => {
	const client = live ? EastIndiaClient.fromEnv() : undefined as unknown as EastIndiaClient;
	const local = mkdtempSync(path.join(tmpdir(), "eastindia-client-live-"));
	const fleet = run;
	const builtTag = `${run}:1`;
	let fleetCreated = false;
	let imageBuilt = false;
	let machine = "";

	before(async () => {
		mkdirSync(path.join(local, "bind"));
		writeFileSync(path.join(local, "bind", "seed.txt"), "seeded by the Node SDK\r\n");
		writeFileSync(path.join(local, "compose.yaml"), [
			"services:",
			"  app:",
			`    image: ${baseImage}`,
			`    mem_limit: ${machineMemory}`,
			"    volumes:",
			"      - ./bind:C:/sdk-node-bind",
			"",
		].join("\n"));
		const resolved = await resolveComposeModel({ files: [path.join(local, "compose.yaml")], projectName: fleet, cli: process.env["EASTINDIA_CLI"] ?? "endia" });
		fleetCreated = true;
		const up = await client.fleets.up(resolved.text, { projectDirectory: local, configFiles: [path.join(local, "compose.yaml")] });
		const result = await up.result();
		assert.equal(result.fleet, fleet);
		machine = (await waitUntilReady(client, fleet)).name;
	});

	after(async () => {
		try {
			if (fleetCreated) {
				await (await client.fleets.down(fleet, { volumes: true })).result();
			}

			if (imageBuilt) {
				await client.images.remove(builtTag);
			}

			// Nothing this run made may be left: no machine, no fleet and no image tag with its name.
			assert.deepEqual((await client.machines.list({ all: true })).filter((each) => each.name.startsWith(run)), []);
			assert.deepEqual((await client.fleets.list({ all: true })).filter((each) => each.name.startsWith(run)), []);
			assert.deepEqual((await client.images.list()).flatMap((image) => image.repoTags).filter((tag) => tag.startsWith(run)), []);
		}
		finally {
			client.close();
			rmSync(local, { recursive: true, force: true });
		}
	});

	it("version_ReadsTheServicesVersion", async () => {
		const version = await client.version();
		assert.equal(version.apiVersion, "1");
		assert.match(version.version, /^\d+\.\d+\.\d+/u);
	});

	it("images_ListAndInspect_FindTheDevelopmentImage", async () => {
		const listed = await client.images.list();
		const development = listed.find((image) => image.repoTags.includes(baseImage));
		assert.ok(development, `${baseImage} is listed`);
		assert.equal((await client.images.inspect(baseImage)).id, development.id);
	});

	it("refusal_ImageThatDoesNotExist_IsEastIndiaApiErrorNotFound", async () => {
		await assert.rejects(client.images.inspect(`${prefix}missing:none`), (error: unknown) => {
			assert.ok(error instanceof EastIndiaApiError);
			assert.equal(error.status, 404);
			assert.equal(error.code, "NOT_FOUND");
			return true;
		});
	});

	it("connection_ClientCertificateFromAnotherAuthority_IsRefusedByTheService", async () => {
		const real = connectionFromEnvironment(process.env);
		const stranger = new EastIndiaClient({ host: real.host, tls: { ca: real.tls?.ca ?? "", cert: tlsFile("stranger-client.pem"), key: tlsFile("stranger-client.key") }, requestRetries: 0 });
		try {
			await assert.rejects(stranger.version(), (error: unknown) => error instanceof EastIndiaConnectionError && error.failure === "certificateRefused");
		}
		finally {
			stranger.close();
		}
	});

	it("connection_ServerTrustedThroughAnotherAuthority_IsNotTrusted", async () => {
		const real = connectionFromEnvironment(process.env);
		const misled = new EastIndiaClient({ host: real.host, tls: { ca: tlsFile("ca.pem"), cert: real.tls?.cert ?? "", key: real.tls?.key ?? "" }, requestRetries: 0 });
		try {
			await assert.rejects(misled.version(), (error: unknown) => error instanceof EastIndiaConnectionError && error.failure === "serverNotTrusted");
		}
		finally {
			misled.close();
		}
	});

	it("exec_Attached_GivesBothStreamsAndAnExitCodeAbove255", async () => {
		const result = await client.execs.run(machine, { cmd: ["cmd", "/c", "echo to-stdout& echo to-stderr 1>&2& exit 3010"] });
		assert.equal(result.exitCode, 3010);
		assert.match(result.stdout, /to-stdout/u);
		assert.match(result.stderr, /to-stderr/u);
	});

	it("exec_Detached_ThenProcessWait_GivesTheProgramsExitCode", async () => {
		const started = await client.execs.start(machine, { cmd: ["cmd", "/c", "ping -n 3 127.0.0.1 > nul & exit 7"] });
		const waited = await client.processes.wait(machine, started.processId, { started: started.started, timeout: 120 });
		assert.equal(waited.exitCode, 7);
	});

	it("bindMount_SourceFolder_ArrivesInTheMachine", async () => {
		const result = await client.execs.run(machine, { cmd: ["cmd", "/c", "type C:\\sdk-node-bind\\seed.txt"] });
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /seeded by the Node SDK/u);
	});

	it("archives_CopyInThenOut_BringsBackTheSameBytes", async () => {
		const name = `${run}.txt`;
		writeFileSync(path.join(local, name), "copied in and out by the Node SDK\r\n");
		await client.archives.copyIn(machine, path.join(local, name), "C:/Users/Public");
		try {
			const stat = await client.archives.stat(machine, `C:/Users/Public/${name}`);
			assert.equal(stat?.mode, "file");
			const stat2 = await client.archives.copyOut(machine, `C:/Users/Public/${name}`, path.join(local, "out"));
			assert.equal(stat2.name, name);
			assert.equal(readFileSync(path.join(local, "out", name), "utf8"), "copied in and out by the Node SDK\r\n");
		}
		finally {
			await client.archives.delete(machine, `C:/Users/Public/${name}`);
		}

		assert.equal(await client.archives.stat(machine, `C:/Users/Public/${name}`), null);
	});

	it("desktop_LaunchNotepad_ThenWaitForItsWindow", async () => {
		const launched = await client.desktop.launch(machine, { program: "notepad.exe" });
		try {
			const found = await client.desktop.wait(machine, { processId: launched.processId, started: launched.started, element: "Window", timeoutSeconds: 120 });
			assert.equal(found.element?.controlType, "Window");
			assert.ok(found.window);
		}
		finally {
			await client.processes.stop(machine, launched.processId, { started: launched.started, timeout: 0 });
		}
	});

	it("build_SmallImageOverTheDevelopmentImage_IsTaggedThenRemoved", async () => {
		const context = path.join(local, "context");
		mkdirSync(context);
		writeFileSync(path.join(context, "Dockerfile"), `FROM ${baseImage}\nCOPY hello.txt C:/sdk-node/hello.txt\n`);
		writeFileSync(path.join(context, "hello.txt"), "built by the Node SDK\r\n");
		writeFileSync(path.join(context, ".dockerignore"), "*.tmp\n");
		writeFileSync(path.join(context, "scratch.tmp"), "left out");
		imageBuilt = true;
		const build = await client.images.build({ folder: context }, { tags: [builtTag], labels: { "org.eastindia.sdk": "node" } });
		const result = await build.result();
		assert.deepEqual(result.tags, [builtTag]);
		assert.equal((await client.images.inspect(builtTag)).labels["org.eastindia.sdk"], "node");
		assert.equal((await client.images.remove(builtTag)).length > 0, true);
		imageBuilt = false;
	});
});

// The fleet's one machine, once it runs and its guest service has reported ready.
async function waitUntilReady(client: EastIndiaClient, fleet: string): Promise<MachineSummary> {
	const deadline = Date.now() + readyTimeoutMilliseconds;
	for (;;) {
		const machines = (await client.fleets.inspect(fleet)).machines;
		const ready = machines.find((each) => each.state === "running" && each.ready);
		if (ready !== undefined) {
			return ready;
		}

		assert.ok(Date.now() < deadline, `The machine of ${fleet} was not ready within ${String(readyTimeoutMilliseconds / 60000)} minutes.`);
		await delay(pollMilliseconds);
	}
}
