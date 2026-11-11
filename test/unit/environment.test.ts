import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { connectionFromEnvironment } from "../../src/environment.js";
import { TlsFolder, tlsFile } from "../support/fake-service.js";

describe("connectionFromEnvironment", () => {
	let home: string;
	let config: string;

	beforeEach(() => {
		home = mkdtempSync(path.join(tmpdir(), "eastindia-client-home-"));
		config = path.join(home, ".eastindia");
		mkdirSync(config);
	});

	afterEach(() => {
		rmSync(home, { recursive: true, force: true });
	});

	// Stores a context as `endia context create` stores it. Its meta.json and its certificate files each go in a folder named by
	// the SHA-256 of the context's name.
	function storeContext(name: string, host: string): void {
		const folder = createHash("sha256").update(name).digest("hex");
		mkdirSync(path.join(config, "contexts", "meta", folder), { recursive: true });
		writeFileSync(path.join(config, "contexts", "meta", folder, "meta.json"), JSON.stringify({
			Name: name,
			Metadata: { Description: "EastIndia on the test PC" },
			Endpoints: { eastindia: { Host: host } },
		}));
		cpSync(TlsFolder, path.join(config, "contexts", "tls", folder, "eastindia"), { recursive: true });
	}

	// Examples of use

	it("connectionFromEnvironment_CurrentContextInConfigJson_ConnectsWithItsAddressCertificatesAndRetries", () => {
		storeContext("pc", "tcp://host.docker.internal:7443");
		writeFileSync(path.join(config, "config.json"), JSON.stringify({ currentContext: "pc", requestRetries: 5, requestRetryDelayMilliseconds: 250 }));
		const chosen = connectionFromEnvironment({}, home, false);
		assert.equal(chosen.host, "tcp://host.docker.internal:7443");
		assert.equal(chosen.tls?.cert, tlsFile("cert.pem"));
		assert.equal(chosen.requestRetries, 5);
		assert.equal(chosen.requestRetryDelayMilliseconds, 250);
	});

	it("connectionFromEnvironment_EastIndiaHost_WinsOverTheCurrentContextAndReadsEastIndiaCertPath", () => {
		storeContext("pc", "tcp://host.docker.internal:7443");
		writeFileSync(path.join(config, "config.json"), JSON.stringify({ currentContext: "pc" }));
		const chosen = connectionFromEnvironment({ EASTINDIA_HOST: "tcp://10.0.0.5:7443", EASTINDIA_CERT_PATH: TlsFolder }, home, false);
		assert.equal(chosen.host, "tcp://10.0.0.5:7443");
		assert.equal(chosen.tls?.ca, tlsFile("ca.pem"));
		assert.equal(chosen.requestRetries, 2);
	});

	it("connectionFromEnvironment_EastIndiaContext_WinsOverTheCurrentContext", () => {
		storeContext("pc", "tcp://host.docker.internal:7443");
		storeContext("lab", "tcp://lab.example:7443");
		writeFileSync(path.join(config, "config.json"), JSON.stringify({ currentContext: "pc" }));
		assert.equal(connectionFromEnvironment({ EASTINDIA_CONTEXT: "lab" }, home, false).host, "tcp://lab.example:7443");
	});

	it("connectionFromEnvironment_NoContextOnWindows_IsTheNamedPipeWithoutCertificates", () => {
		const chosen = connectionFromEnvironment({}, home, true);
		assert.equal(chosen.host, "npipe:////./pipe/eastindia_engine");
		assert.equal(chosen.tls, undefined);
	});

	it("connectionFromEnvironment_NoContextElsewhere_IsTheLocalPortWithTheConfigurationFoldersCertificates", () => {
		cpSync(TlsFolder, config, { recursive: true });
		const chosen = connectionFromEnvironment({}, home, false);
		assert.equal(chosen.host, "tcp://127.0.0.1:7443");
		assert.equal(chosen.tls?.key, tlsFile("key.pem"));
	});

	it("connectionFromEnvironment_EastIndiaConfig_MovesTheConfigurationFolder", () => {
		const moved = path.join(home, "elsewhere");
		mkdirSync(moved);
		writeFileSync(path.join(moved, "config.json"), JSON.stringify({ currentContext: "default" }));
		cpSync(TlsFolder, moved, { recursive: true });
		assert.equal(connectionFromEnvironment({ EASTINDIA_CONFIG: moved }, home, false).tls?.ca, tlsFile("ca.pem"));
	});

	// Examples of misuse

	it("connectionFromEnvironment_UnknownKeyInConfigJson_IsRefusedNamingIt", () => {
		writeFileSync(path.join(config, "config.json"), JSON.stringify({ currentContext: "pc", retries: 3 }));
		assert.throws(() => connectionFromEnvironment({}, home, false), /unknown key 'retries'/u);
	});

	it("connectionFromEnvironment_RetriesOutOfRange_IsRefusedNamingTheKey", () => {
		writeFileSync(path.join(config, "config.json"), JSON.stringify({ requestRetries: 11 }));
		assert.throws(() => connectionFromEnvironment({}, home, false), /'requestRetries' must be an integer from 0 to 10/u);
	});

	it("connectionFromEnvironment_ContextThatDoesNotExist_IsRefusedNamingIt", () => {
		assert.throws(() => connectionFromEnvironment({ EASTINDIA_CONTEXT: "gone" }, home, false), /Context "gone" does not exist/u);
	});

	it("connectionFromEnvironment_MissingCertificateFile_IsRefusedNamingTheFile", () => {
		assert.throws(() => connectionFromEnvironment({ EASTINDIA_HOST: "tcp://10.0.0.5:7443", EASTINDIA_CERT_PATH: home }, home, false), /Cannot read ca\.pem/u);
	});
});
