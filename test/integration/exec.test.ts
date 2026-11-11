import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { ExecDetail } from "../../src/contract/execs.js";
import { EastIndiaApiError } from "../../src/errors.js";
import { encodeFrame, FrameStream } from "../../src/exec/exec-frame.js";
import { ExecsClient } from "../../src/groups/execs.js";
import type { EastIndiaClient } from "../../src/eastindia-client.js";
import { FakeService } from "../support/fake-service.js";

const execId = "9f86d081884c7d659a2feaa0c55ad015";

/** The exec record the service holds once the program has ended with an exit code. */
function ended(exitCode: number | null, startError: string | null = null): ExecDetail {
	return {
		id: execId,
		machine: "shop-web-1",
		bootId: "b1",
		cmd: ["cmd", "/c", "exit 3010"],
		user: null,
		workingDir: null,
		tty: false,
		detached: false,
		processId: 4120,
		started: "2026-11-02T21:00:00.0000000Z",
		running: false,
		exitCode,
		exited: "2026-11-02T21:00:01.0000000Z",
		startError,
	};
}

describe("exec", () => {
	let service: FakeService | undefined;
	let client: EastIndiaClient | undefined;

	afterEach(async () => {
		client?.close();
		await service?.close();
		service = undefined;
		client = undefined;
	});

	it("run_ProgramWritingBothStreamsAndExiting3010_GivesBothStreamsAndTheFullExitCode", async () => {
		service = (await FakeService.overHttps())
			.json("POST", "/v1/machines/shop-web-1/exec", 201, { id: execId })
			.json("GET", `/v1/execs/${execId}`, 200, ended(3010))
			.onSocket(`/v1/execs/${execId}/start`, (socket) => {
				socket.send(encodeFrame(FrameStream.stdout, Buffer.from("installing\r\n")));
				socket.send(encodeFrame(FrameStream.stderr, Buffer.from("restart required\r\n")));
				socket.send(encodeFrame(FrameStream.stdout, Buffer.from("done\r\n")));
				socket.close(1000);
			});
		client = service.client();

		const result = await client.execs.run("shop-web-1", { cmd: ["cmd", "/c", "exit 3010"] });

		assert.equal(result.exitCode, 3010);
		assert.equal(result.stdout, "installing\r\ndone\r\n");
		assert.equal(result.stderr, "restart required\r\n");
		assert.deepEqual(JSON.parse(service.requests[0]?.body.toString() ?? ""), { cmd: ["cmd", "/c", "exit 3010"], attachStdin: false });
	});

	it("run_WithInput_SendsItAsStandardInputFramesThenTheEmptyFrameThatClosesIt", async () => {
		const received: Buffer[] = [];
		service = (await FakeService.overSocket())
			.json("POST", "/v1/machines/shop-web-1/exec", 201, { id: execId })
			.json("GET", `/v1/execs/${execId}`, 200, ended(0))
			.onSocket(`/v1/execs/${execId}/start`, (socket) => {
				socket.on("message", (message: Buffer) => {
					received.push(message);
					// An eight-byte message is the empty standard-input frame, which closes the program's input; the fake program then
					// writes its answer and the fake service closes the WebSocket.
					if (message.length === 8) {
						socket.send(encodeFrame(FrameStream.stdout, Buffer.from("read 5 bytes")));
						socket.close(1000);
					}
				});
			});
		const connection = service.connection();
		try {
			const result = await new ExecsClient(connection).run("shop-web-1", { cmd: ["findstr", "x"] }, { input: "hello" });
			assert.equal(result.stdout, "read 5 bytes");
			assert.deepEqual(received, [encodeFrame(FrameStream.stdin, Buffer.from("hello")), encodeFrame(FrameStream.stdin, Buffer.alloc(0))]);
			assert.equal((JSON.parse(service.requests[0]?.body.toString() ?? "") as { attachStdin: boolean }).attachStdin, true);
		}
		finally {
			connection.close();
		}
	});

	it("spawn_WithAConsole_ReadsRawBytesAsStandardOutput", async () => {
		service = (await FakeService.overHttps())
			.json("POST", "/v1/machines/shop-web-1/exec", 201, { id: execId })
			.json("GET", `/v1/execs/${execId}`, 200, { ...ended(0), tty: true })
			.onSocket(`/v1/execs/${execId}/start`, (socket) => {
				// With a console the service sends raw bytes. These five bytes are shorter than a frame's header, so the test fails if the
				// client reads them as frames.
				socket.send(Buffer.from([0x1b, 0x5b, 0x32, 0x4a, 0x41]));
				socket.close(1000);
			});
		client = service.client();

		const session = await client.execs.spawn("shop-web-1", { cmd: ["cmd"], tty: true, consoleSize: [24, 80] });
		const chunks: Buffer[] = [];
		for await (const chunk of session.stdout) {
			chunks.push(chunk as Buffer);
		}

		assert.deepEqual(Buffer.concat(chunks), Buffer.from([0x1b, 0x5b, 0x32, 0x4a, 0x41]));
		assert.equal((await session.wait()).exitCode, 0);
		assert.equal(session.stdin, null);
	});

	it("run_ProgramNotFound_GivesExitCode127AndTheStartError", async () => {
		service = (await FakeService.overHttps())
			.json("POST", "/v1/machines/shop-web-1/exec", 201, { id: execId })
			.json("GET", `/v1/execs/${execId}`, 200, ended(127, "The program 'nosuch.exe' was not found."))
			.onSocket(`/v1/execs/${execId}/start`, (socket) => {
				socket.close(1000);
			});
		client = service.client();
		const result = await client.execs.run("shop-web-1", { cmd: ["nosuch.exe"] });
		assert.equal(result.exitCode, 127);
		assert.equal(result.startError, "The program 'nosuch.exe' was not found.");
	});

	it("start_Detached_GivesTheExecIdAndTheProcess", async () => {
		service = (await FakeService.overHttps())
			.json("POST", "/v1/machines/shop-web-1/exec", 201, { id: execId })
			.json("POST", `/v1/execs/${execId}/start`, 200, { processId: 4120, started: "2026-11-02T21:00:00.1234567Z" });
		client = service.client();
		assert.deepEqual(await client.execs.start("shop-web-1", { cmd: ["ping", "-t", "localhost"] }), { id: execId, processId: 4120, started: "2026-11-02T21:00:00.1234567Z" });
		assert.equal(service.requests[1]?.body.toString(), JSON.stringify({ detach: true }));
	});

	it("attach_RefusedUpgrade_IsEastIndiaApiErrorWithTheServicesError", async () => {
		// The fake service refuses the upgrade of an exec it does not know with 404 NOT_FOUND and the error as its body.
		service = await FakeService.overHttps();
		client = service.client();
		await assert.rejects(client.execs.attach("0000", { tty: false, attachStdin: false }), (error: unknown) => {
			assert.ok(error instanceof EastIndiaApiError);
			assert.equal(error.status, 404);
			assert.equal(error.code, "NOT_FOUND");
			return true;
		});
	});
});
