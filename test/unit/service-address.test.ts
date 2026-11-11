import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeServiceAddress, parseServiceAddress } from "../../src/transport/service-address.js";

describe("parseServiceAddress", () => {
	// Examples of use

	it("parseServiceAddress_TcpAddress_IsHttpsToThatHostAndPort", () => {
		assert.deepEqual(parseServiceAddress("tcp://host.docker.internal:7443", "EASTINDIA_HOST"), { kind: "https", hostname: "host.docker.internal", port: 7443 });
	});

	it("parseServiceAddress_TcpAddressWithIpv6_DropsTheBrackets", () => {
		const address = parseServiceAddress("tcp://[::1]:7443", "host");
		assert.deepEqual(address, { kind: "https", hostname: "::1", port: 7443 });
		assert.equal(describeServiceAddress(address), "[::1]:7443");
	});

	it("parseServiceAddress_NamedPipe_IsThePipesWindowsPath", () => {
		const address = parseServiceAddress("npipe:////./pipe/eastindia_engine", "host");
		assert.deepEqual(address, { kind: "socket", path: "\\\\.\\pipe\\eastindia_engine" });
		assert.equal(describeServiceAddress(address), "\\\\.\\pipe\\eastindia_engine");
	});

	// Examples of misuse: each is refused with the setting it came from named.

	for (const host of ["https://host:7443", "tcp://host", "tcp://host:7443/v1", "npipe:////./pipe/", "npipe:////server/pipe/eastindia_engine", "host:7443"]) {
		it(`parseServiceAddress_${host}_IsRefused`, () => {
			assert.throws(() => parseServiceAddress(host, "EASTINDIA_HOST"), /^Error: EASTINDIA_HOST must be/u);
		});
	}
});
