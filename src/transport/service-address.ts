/**
 * Where the client sends its requests: a host and port reached over HTTPS with mutual TLS, or a local socket, which on Windows is
 * the service's named pipe and needs no certificate. The `endia` CLI writes the same two places as `tcp://<host>:<port>` and
 * `npipe:////./pipe/<name>`, and `parseServiceAddress` reads those forms.
 */
export type ServiceAddress =
	| { readonly kind: "https"; readonly hostname: string; readonly port: number }
	| { readonly kind: "socket"; readonly path: string };

/** The prefix of a named pipe address, as Docker writes `npipe:////./pipe/docker_engine`. */
const PipePrefix = "npipe://";

/** The pipe part of a named pipe address: `//./pipe/` and then the pipe's name, which holds no slash or backslash. */
const PipePath = /^\/\/\.\/pipe\/(?<name>[^/\\]+)$/u;

/**
 * Reads an address in the forms the CLI and `EASTINDIA_HOST` take: `tcp://<host>:<port>`, over which TLS is always used and always
 * verified, or `npipe:////./pipe/<name>`, a named pipe on this PC.
 *
 * @param host - The address, for example `tcp://host.docker.internal:7443` or `npipe:////./pipe/eastindia_engine`.
 * @param setting - Where the address came from, which the error message names, for example `EASTINDIA_HOST`.
 * @returns Where the client connects.
 * @throws Error when the address has neither form.
 */
export function parseServiceAddress(host: string, setting: string): ServiceAddress {
	if (host.startsWith(PipePrefix)) {
		const pipe = PipePath.exec(host.slice(PipePrefix.length));
		if (pipe?.groups?.["name"] === undefined) {
			throw new Error(`${setting} must be npipe:////./pipe/<name>; found '${host}'.`);
		}

		return { kind: "socket", path: `\\\\.\\pipe\\${pipe.groups["name"]}` };
	}

	const parsed = URL.canParse(host) ? new URL(host) : undefined;
	if (parsed?.protocol !== "tcp:" || parsed.port === "" || !["", "/"].includes(parsed.pathname) || parsed.search !== "" || parsed.hash !== "") {
		throw new Error(`${setting} must be tcp://<host>:<port> or npipe:////./pipe/<name>; found '${host}'.`);
	}

	// URL keeps an IPv6 address in brackets; the TLS check and the connection take it without them.
	return { kind: "https", hostname: parsed.hostname.replace(/^\[(?<inner>.*)\]$/u, "$<inner>"), port: Number(parsed.port) };
}

/**
 * Names an address as messages name it: the host and port, or the socket's path.
 *
 * @param address - The address.
 * @returns For example `host.docker.internal:7443` or `\\.\pipe\eastindia_engine`.
 */
export function describeServiceAddress(address: ServiceAddress): string {
	return address.kind === "https" ? `${address.hostname.includes(":") ? `[${address.hostname}]` : address.hostname}:${String(address.port)}` : address.path;
}
