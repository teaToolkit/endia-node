import assert from "node:assert/strict";
import net from "node:net";
import { afterEach, describe, it } from "node:test";
import { EastIndiaApiError, EastIndiaConnectionError } from "../../src/errors.js";
import { DesktopClient } from "../../src/groups/desktop.js";
import { VolumesClient } from "../../src/groups/volumes.js";
import { EastIndiaClient } from "../../src/eastindia-client.js";
import { FakeService, tlsFile } from "../support/fake-service.js";

const version = { version: "0.16.9", apiVersion: "1", gitCommit: "35c4f8f", built: "2026-10-31T21:59:35.0000000Z", os: "windows", arch: "amd64", guestServiceVersion: "0.16.9" };

describe("the connection to the service", () => {
	let service: FakeService | undefined;
	let client: EastIndiaClient | undefined;

	afterEach(async () => {
		client?.close();
		await service?.close();
		service = undefined;
		client = undefined;
	});

	it("version_OverMutualTls_PresentsTheCallersCertificateAndReadsTheAnswer", async () => {
		service = (await FakeService.overHttps()).json("GET", "/v1/version", 200, version);
		client = service.client();
		assert.deepEqual(await client.version(), version);
	});

	it("refusal_WithTheApiErrorBody_BecomesEastIndiaApiErrorWithCodeAndFieldPath", async () => {
		service = (await FakeService.overHttps()).json("GET", "/v1/images/lab/dotnet:10", 404, { code: "NOT_FOUND", message: "The image lab/dotnet:10 does not exist.", fieldPath: "reference", details: null });
		client = service.client();
		await assert.rejects(client.images.inspect("lab/dotnet:10"), (error: unknown) => {
			assert.ok(error instanceof EastIndiaApiError);
			assert.equal(error.status, 404);
			assert.equal(error.code, "NOT_FOUND");
			assert.equal(error.fieldPath, "reference");
			return true;
		});
	});

	it("refusedHead_CarriesItsErrorInTheHeader_AndAMissingPathIsNull", async () => {
		const missing = Buffer.from(JSON.stringify({ code: "NOT_FOUND", message: "C:/absent does not exist.", fieldPath: "path", details: null })).toString("base64");
		service = (await FakeService.overHttps()).on("HEAD", "/v1/machines/shop-web-1/archive", (_received, response) => {
			response.writeHead(404, { "X-EastIndia-Error": missing }).end();
		});
		client = service.client();
		assert.equal(await client.archives.stat("shop-web-1", "C:/absent"), null);
	});

	it("changingRequest_ConnectionDroppedBeforeAnyReply_IsSentAgainWithTheSameIdempotencyKey", async () => {
		let attempts = 0;
		service = (await FakeService.overHttps()).on("PUT", "/v1/images/tags/lab/dotnet:approved", (_received, response) => {
			attempts++;
			if (attempts === 1) {
				response.socket?.destroy();
				return;
			}

			response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ target: "lab/dotnet:approved", digest: "sha256:0a", previousDigest: null }));
		});
		client = service.client();
		const tagged = await client.images.tag("lab/dotnet:10", "lab/dotnet:approved");
		assert.equal(tagged.digest, "sha256:0a");
		const keys = service.requests.map((request) => request.headers["idempotency-key"]);
		assert.equal(keys.length, 2);
		assert.match(String(keys[0]), /^[0-9a-f]{32}$/u);
		assert.equal(keys[1], keys[0]);
		assert.deepEqual(JSON.parse(service.requests[1]?.body.toString() ?? ""), { source: "lab/dotnet:10" });
	});

	it("changingRequest_ConnectionDroppedOnEveryAttempt_IsSentOnceAndThenRequestRetriesTimesMore", async () => {
		service = (await FakeService.overHttps()).on("POST", "/v1/operations/0123/cancel", (_received, response) => {
			response.socket?.destroy();
		});
		client = service.client({ requestRetries: 3 });
		await assert.rejects(client.operations.cancel("0123"), (error: unknown) => error instanceof EastIndiaConnectionError && error.failure === "unreachable");
		assert.equal(service.requests.length, 4);
	});

	it("read_ConnectionDropped_IsNotSentAgain", async () => {
		service = (await FakeService.overHttps()).on("GET", "/v1/version", (_received, response) => {
			response.socket?.destroy();
		});
		client = service.client();
		await assert.rejects(client.version(), EastIndiaConnectionError);
		assert.equal(service.requests.length, 1);
	});

	it("requestsCarryingASecret_AreSentOnceWithoutAnIdempotencyKey", async () => {
		service = (await FakeService.overHttps())
			.on("POST", "/v1/machines/shop-web-1/desktop/set-value", (_received, response) => {
				response.socket?.destroy();
			})
			.json("POST", "/v1/machines/shop-web-1/desktop/uac", 200, { outcome: "answered" });
		client = service.client();
		await assert.rejects(client.desktop.setValue("shop-web-1", { processId: 4120, element: "Sign in/Password", value: "s3cret", secret: true }), EastIndiaConnectionError);
		await client.desktop.answerPrompt("shop-web-1", { expectedProgram: "setup.exe", action: "credentials", user: "testadmin", password: "s3cret" });
		assert.equal(service.requests.length, 2);
		assert.deepEqual(service.requests.map((request) => request.headers["idempotency-key"]), [undefined, undefined]);
	});

	it("request_UnansweredWithinTheTimeLimit_IsTimedOut", async () => {
		service = (await FakeService.overHttps()).on("GET", "/v1/info", () => {
			// The fake service never answers.
		});
		client = service.client({ requestTimeoutMilliseconds: 200 });
		await assert.rejects(client.info(), (error: unknown) => error instanceof EastIndiaConnectionError && error.failure === "timedOut");
	});

	it("request_CancelledByTheCaller_RejectsWithTheCallersReason", async () => {
		service = (await FakeService.overHttps()).on("GET", "/v1/info", () => {
			// The fake service never answers.
		});
		client = service.client();
		await assert.rejects(client.info(AbortSignal.timeout(100)), (error: unknown) => error instanceof DOMException && error.name === "TimeoutError");
	});

	it("serverWithACertificateFromAnotherAuthority_IsNotTrusted", async () => {
		service = (await FakeService.overHttps({ server: "stranger-server" })).json("GET", "/v1/version", 200, version);
		client = service.client();
		await assert.rejects(client.version(), (error: unknown) => error instanceof EastIndiaConnectionError && error.failure === "serverNotTrusted");
		assert.equal(service.requests.length, 0);
	});

	it("nothingListening_IsUnreachable", async () => {
		// A port that was free a moment ago has nothing listening on it.
		const probe = net.createServer();
		await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
		const port = (probe.address() as net.AddressInfo).port;
		await new Promise<void>((resolve) => probe.close(() => {
			resolve();
		}));
		client = new EastIndiaClient({ host: `tcp://127.0.0.1:${String(port)}`, tls: { ca: tlsFile("ca.pem"), cert: tlsFile("cert.pem"), key: tlsFile("key.pem") }, requestRetries: 0 });
		await assert.rejects(client.version(), (error: unknown) => {
			assert.ok(error instanceof EastIndiaConnectionError);
			assert.equal(error.failure, "unreachable");
			assert.equal(error.message, `Cannot connect to the EastIndia service at 127.0.0.1:${String(port)}. Is the service running?`);
			return true;
		});
	});

	it("localSocket_ServesTheSameRoutesWithoutACertificate", async () => {
		service = (await FakeService.overSocket()).on("DELETE", "/v1/volumes/shop_data", (_received, response) => {
			response.writeHead(204).end();
		});
		const connection = service.connection({ tls: undefined });
		try {
			await new VolumesClient(connection).remove("shop_data");
			const sent = service.requests[0];
			assert.equal(sent?.headers.host, "localhost");
			assert.match(String(sent.headers["idempotency-key"]), /^[0-9a-f]{32}$/u);
		}
		finally {
			connection.close();
		}
	});

	it("screenshot_ReadsThePngAndItsHeaders", async () => {
		service = (await FakeService.overSocket()).on("POST", "/v1/machines/shop-web-1/desktop/screenshot", (_received, response) => {
			response.writeHead(200, {
				"Content-Type": "image/png",
				"X-EastIndia-Width": "1280",
				"X-EastIndia-Height": "800",
				"X-EastIndia-Session": "1",
				"X-EastIndia-Taken": "2026-11-02T21:00:00.0000000Z",
			}).end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
		});
		const connection = service.connection();
		try {
			const picture = await new DesktopClient(connection).screenshot("shop-web-1", { processId: 4120 });
			assert.deepEqual(picture, { png: Buffer.from([0x89, 0x50, 0x4e, 0x47]), width: 1280, height: 800, sessionId: 1, taken: "2026-11-02T21:00:00.0000000Z" });
			assert.equal(service.requests[0]?.headers["idempotency-key"], undefined);
			assert.equal(service.requests[0]?.body.toString(), JSON.stringify({ processId: 4120 }));
		}
		finally {
			connection.close();
		}
	});
});
