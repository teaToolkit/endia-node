import type { SystemInfo, VersionInfo } from "./contract/status.js";
import { connectionFromEnvironment } from "./environment.js";
import { ArchivesClient } from "./groups/archives.js";
import { BasesClient } from "./groups/bases.js";
import { CertificatesClient } from "./groups/certificates.js";
import { DesktopClient } from "./groups/desktop.js";
import { ExecsClient } from "./groups/execs.js";
import { FleetsClient } from "./groups/fleets.js";
import { ImagesClient } from "./groups/images.js";
import { MachinesClient } from "./groups/machines.js";
import { OperationsClient } from "./groups/operations.js";
import { ProcessesClient } from "./groups/processes.js";
import { StatsClient } from "./groups/stats.js";
import { SystemClient } from "./groups/system.js";
import { VolumesClient } from "./groups/volumes.js";
import { Routes } from "./routes.js";
import { ApiConnection } from "./transport/api-connection.js";
import type { TlsFiles } from "./transport/tls-files.js";
import { parseServiceAddress, type ServiceAddress } from "./transport/service-address.js";

/** Everything a client needs to reach one EastIndia service as one caller. */
export interface ClientOptions {
	/**
	 * The service's address, in one of the two forms `EASTINDIA_HOST` takes.
	 *
	 * - `tcp://<host>:<port>`: the client connects over HTTPS with mutual TLS.
	 * - `npipe:////./pipe/<name>`: the client connects through a named pipe on this Windows PC. The pipe needs no certificate,
	 *   because Windows checks which account opens it.
	 */
	readonly host: string;
	/** The certificate files as PEM text; required over TCP, unused on the named pipe. `readTlsFolder` reads them from a folder. */
	readonly tls?: TlsFiles;
	/**
	 * The time allowed for one request, in milliseconds; 100 seconds when undefined. It does not apply to an upload, a streamed
	 * answer such as a followed log, a wait the service answers only when it ends, or a request sent once.
	 */
	readonly requestTimeoutMilliseconds?: number;
	/** How many times a changing request is sent again after its connection failed before any reply; 2 when undefined. */
	readonly requestRetries?: number;
	/** The time between those attempts, in milliseconds; 1000 when undefined. */
	readonly requestRetryDelayMilliseconds?: number;
}

/** The time allowed for one request when the options give none: the CLI's own. */
const DefaultRequestTimeoutMilliseconds = 100_000;

/** The retries when the options give none: the defaults of the CLI's `requestRetries` and `requestRetryDelayMilliseconds`. */
const DefaultRequestRetries = 2;
const DefaultRequestRetryDelayMilliseconds = 1000;

/**
 * The typed client of the EastIndia API. EastIndia is a Windows service that runs Hyper-V Windows machines for tests, as Docker runs
 * containers. A caller creates one client, with `fromEnv` or with explicit options, and calls the route groups below.
 *
 * - `images` builds and keeps images; `bases` imports the images that have no parent.
 * - `fleets` brings Compose projects up and down; `machines` and `volumes` show and control what fleets made.
 * - `execs` runs programs in machines, and `archives` copies files into and out of them.
 * - `processes` waits for and stops the programs in a machine; `desktop` operates the windows of the signed-in user's programs.
 * - `operations` follows the long work the other groups start; `stats` and `system` read and reclaim the host's resources.
 * - `certificates` issues and revokes client certificates, on the named pipe only.
 *
 * Every call reports a failure as one of two errors. `EastIndiaApiError` means the service answered and refused, with the API's error
 * code; `EastIndiaConnectionError` means no answer came.
 */
export class EastIndiaClient {
	private readonly connection: ApiConnection;

	/** The image routes: build, list, inspect, tag and remove. */
	readonly images: ImagesClient;
	/** The base routes: import and prepare. */
	readonly bases: BasesClient;
	/** The operation routes: list, inspect, read the log and cancel; and `handle`, which wraps an operation to wait for its end. */
	readonly operations: OperationsClient;
	/** The fleet routes: up and its dry run, down, stop, start, restart, list, inspect and logs. */
	readonly fleets: FleetsClient;
	/** The machine routes: list, inspect, start, stop, restart and logs. */
	readonly machines: MachinesClient;
	/** The named volume routes: list, inspect and remove. */
	readonly volumes: VolumesClient;
	/** The exec routes: run a program attached or detached. */
	readonly execs: ExecsClient;
	/** The archive routes: copy files into and out of a machine. */
	readonly archives: ArchivesClient;
	/** The process routes: list, inspect, wait, stop and logs. */
	readonly processes: ProcessesClient;
	/** The desktop routes: launch programs and operate their windows. */
	readonly desktop: DesktopClient;
	/** The readings of the machines and of the host. */
	readonly stats: StatsClient;
	/** The disk space routes: df and prune. */
	readonly system: SystemClient;
	/** The client certificate routes, which the service answers on its named pipe only. */
	readonly certificates: CertificatesClient;

	/**
	 * Creates a client. No request is sent until a route is called.
	 *
	 * @param options - The address, the certificate files and the retries.
	 * @throws Error when the address has neither form, or when an address over TCP comes without the certificate files.
	 */
	constructor(options: ClientOptions) {
		this.connection = EastIndiaClient.connect(parseServiceAddress(options.host, "host"), options);
		this.operations = new OperationsClient(this.connection);
		this.images = new ImagesClient(this.connection, this.operations);
		this.bases = new BasesClient(this.connection, this.operations);
		this.fleets = new FleetsClient(this.connection, this.operations);
		this.machines = new MachinesClient(this.connection, this.operations);
		this.volumes = new VolumesClient(this.connection);
		this.execs = new ExecsClient(this.connection);
		this.archives = new ArchivesClient(this.connection);
		this.processes = new ProcessesClient(this.connection);
		this.desktop = new DesktopClient(this.connection);
		this.stats = new StatsClient(this.connection);
		this.system = new SystemClient(this.connection, this.operations);
		this.certificates = new CertificatesClient(this.connection);
	}

	/**
	 * Creates a client that connects as the `endia` CLI does. The address comes from the first of these that is set:
	 *
	 * 1. `EASTINDIA_HOST`, with the certificate files in `EASTINDIA_CERT_PATH`;
	 * 2. the context `EASTINDIA_CONTEXT` names;
	 * 3. the CLI's current context in `~/.eastindia`;
	 * 4. the CLI's built-in context: the named pipe on Windows, `tcp://127.0.0.1:7443` elsewhere.
	 *
	 * The retries are the CLI's `requestRetries` and `requestRetryDelayMilliseconds`.
	 *
	 * @param environment - The environment variables; the process's own when undefined.
	 * @returns The client.
	 * @throws Error when the CLI's settings are not valid, the context named does not exist, or a certificate file cannot be read.
	 */
	static fromEnv(environment: Readonly<Record<string, string | undefined>> = process.env): EastIndiaClient {
		const chosen = connectionFromEnvironment(environment);
		return new EastIndiaClient({
			host: chosen.host,
			tls: chosen.tls,
			requestRetries: chosen.requestRetries,
			requestRetryDelayMilliseconds: chosen.requestRetryDelayMilliseconds,
		});
	}

	/**
	 * Reads the service's version: `endia version`.
	 *
	 * @param signal - Cancels the request.
	 * @returns The version.
	 */
	version(signal?: AbortSignal): Promise<VersionInfo> {
		return this.connection.read(Routes.version, signal);
	}

	/**
	 * Reads the host's description, the configuration in effect and what needs attention: `endia info`.
	 *
	 * @param signal - Cancels the request.
	 * @returns The description.
	 */
	info(signal?: AbortSignal): Promise<SystemInfo> {
		return this.connection.read(Routes.info, signal);
	}

	/** Closes the connections kept open for later requests. Each request sent after `close` opens a new connection. */
	close(): void {
		this.connection.close();
	}

	/** @internal Opens the connection; tests reach a local socket through it, which `host` has no form for. */
	static connect(address: ServiceAddress, options: Omit<ClientOptions, "host">): ApiConnection {
		return new ApiConnection({
			address,
			tls: options.tls,
			requestTimeoutMilliseconds: options.requestTimeoutMilliseconds ?? DefaultRequestTimeoutMilliseconds,
			requestRetries: options.requestRetries ?? DefaultRequestRetries,
			requestRetryDelayMilliseconds: options.requestRetryDelayMilliseconds ?? DefaultRequestRetryDelayMilliseconds,
		});
	}
}
