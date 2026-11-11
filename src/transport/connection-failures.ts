import type { ConnectionFailure } from "../errors.js";

/**
 * The error codes Node gives when this client refuses the server's certificate: OpenSSL's verification results, and Node's own code
 * for a certificate that does not name the address. Any of them means the server is not the EastIndia service the client trusts.
 */
const ServerCertificateRefusals = new Set([
	"CERT_HAS_EXPIRED",
	"CERT_NOT_YET_VALID",
	"CERT_REJECTED",
	"CERT_REVOKED",
	"CERT_SIGNATURE_FAILURE",
	"CERT_UNTRUSTED",
	"DEPTH_ZERO_SELF_SIGNED_CERT",
	"ERR_TLS_CERT_ALTNAME_INVALID",
	"HOSTNAME_MISMATCH",
	"INVALID_CA",
	"INVALID_PURPOSE",
	"PATH_LENGTH_EXCEEDED",
	"SELF_SIGNED_CERT_IN_CHAIN",
	"UNABLE_TO_DECRYPT_CERT_SIGNATURE",
	"UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
	"UNABLE_TO_GET_ISSUER_CERT",
	"UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
	"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

/** The error codes Windows gives, through Node, when it refuses to open a named pipe for the calling account. */
const PipeRefusals = new Set(["EACCES", "EPERM"]);

/**
 * Decides why a request got no answer, from the error Node reported while sending it.
 *
 * A server certificate this client refused carries one of OpenSSL's verification codes. A client certificate the service refused
 * ends the handshake with a TLS alert, whose OpenSSL code and message name the alert; under TLS 1.3 the alert arrives on the first
 * read, after the request has been written, and is still named. A refused named pipe is an access error. Anything else is a
 * connection that never reached the service.
 *
 * @param error - The error Node reported.
 * @param overSocket - Whether the request went to a local socket, such as the named pipe, rather than over HTTPS.
 * @returns The reason no answer came.
 */
export function classifyConnectionFailure(error: unknown, overSocket: boolean): ConnectionFailure {
	const code = codeOf(error);
	if (ServerCertificateRefusals.has(code)) {
		return "serverNotTrusted";
	}

	if (code.includes("ALERT") || messageOf(error).toLowerCase().includes("alert")) {
		return "certificateRefused";
	}

	if (overSocket && PipeRefusals.has(code)) {
		return "pipeRefused";
	}

	return "unreachable";
}

function codeOf(error: unknown): string {
	return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "";
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : "";
}
