import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyConnectionFailure } from "../../src/transport/connection-failures.js";

/** An error as Node reports it, with OpenSSL's or the system's code. */
function nodeError(code: string, message: string): Error {
	return Object.assign(new Error(message), { code });
}

describe("classifyConnectionFailure", () => {
	// Examples of use. The first two codes and messages are those Node 22 on Linux reported against the EastIndia service 0.16.9; the
	// live tests repeat both against the service.

	it("classifyConnectionFailure_ServiceRefusedAClientCertificateFromAnotherAuthority_IsCertificateRefused", () => {
		const refused = nodeError("ERR_SSL_TLSV1_ALERT_UNKNOWN_CA", "00B987DD1A7F0000:error:0A000418:SSL routines:ssl3_read_bytes:tlsv1 alert unknown ca:../ssl/record/rec_layer_s3.c:918:SSL alert number 48");
		assert.equal(classifyConnectionFailure(refused, false), "certificateRefused");
	});

	it("classifyConnectionFailure_ServerCertificateFromAnotherAuthority_IsServerNotTrusted", () => {
		assert.equal(classifyConnectionFailure(nodeError("UNABLE_TO_VERIFY_LEAF_SIGNATURE", "unable to verify the first certificate"), false), "serverNotTrusted");
	});

	it("classifyConnectionFailure_ServerCertificateForAnotherName_IsServerNotTrusted", () => {
		assert.equal(classifyConnectionFailure(nodeError("ERR_TLS_CERT_ALTNAME_INVALID", "Hostname/IP does not match certificate's altnames"), false), "serverNotTrusted");
	});

	it("classifyConnectionFailure_AccessDeniedOnTheNamedPipe_IsPipeRefused", () => {
		assert.equal(classifyConnectionFailure(nodeError("EACCES", "connect EACCES \\\\.\\pipe\\eastindia_engine"), true), "pipeRefused");
	});

	it("classifyConnectionFailure_RefusedConnection_IsUnreachable", () => {
		assert.equal(classifyConnectionFailure(nodeError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:7443"), false), "unreachable");
	});

	// Examples of misuse

	it("classifyConnectionFailure_AccessDeniedOverTcp_IsUnreachableRatherThanPipeRefused", () => {
		assert.equal(classifyConnectionFailure(nodeError("EACCES", "connect EACCES 10.0.0.5:7443"), false), "unreachable");
	});

	it("classifyConnectionFailure_SomethingThatIsNotAnError_IsUnreachable", () => {
		assert.equal(classifyConnectionFailure("socket closed", false), "unreachable");
	});
});
