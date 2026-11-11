import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { TlsFiles } from "./transport/tls-files.js";

/** What `EastIndiaClient.fromEnv` connects with, as the `endia` CLI would choose it. */
export interface EnvironmentConnection {
	/** The address, `tcp://<host>:<port>` or `npipe:////./pipe/<name>`. */
	readonly host: string;
	/** The certificate files, read for an address over TCP; undefined for a named pipe. */
	readonly tls: TlsFiles | undefined;
	/** The CLI's `requestRetries`. */
	readonly requestRetries: number;
	/** The CLI's `requestRetryDelayMilliseconds`. */
	readonly requestRetryDelayMilliseconds: number;
}

/** The environment variables the CLI reads to choose its connection, and the folder that holds its settings and contexts. */
export const EnvironmentVariables = {
	/** The address, which wins over every context. */
	host: "EASTINDIA_HOST",
	/** The folder of `ca.pem`, `cert.pem` and `key.pem` for the address in `EASTINDIA_HOST`. */
	certPath: "EASTINDIA_CERT_PATH",
	/** The context to use instead of the current one. */
	context: "EASTINDIA_CONTEXT",
	/** The configuration folder instead of `.eastindia` in the home folder. */
	config: "EASTINDIA_CONFIG",
} as const;

/** The configuration folder's name in the home folder, as Docker's is `.docker`. */
const ConfigFolderName = ".eastindia";

/** The settings file in the configuration folder. */
const SettingsFileName = "config.json";

/** The name of the built-in context, which no file stores. */
const DefaultContext = "default";

/** The built-in context's address on Windows: the installed service's named pipe. */
const DefaultPipeHost = "npipe:////./pipe/eastindia_engine";

/** The built-in context's address elsewhere: the service's port on this computer. */
const DefaultTcpHost = "tcp://127.0.0.1:7443";

/** The key under which a context's `meta.json` names its endpoint, as Docker's is `docker`. */
const EndpointKey = "eastindia";

/** The defaults of the settings that `config.json` may leave out, and their ranges. */
const RequestRetries = { default: 2, minimum: 0, maximum: 10 } as const;
const RequestRetryDelayMilliseconds = { default: 1000, minimum: 100, maximum: 2147483647 } as const;

/** The CLI's settings in `config.json`, each optional. */
interface CliSettings {
	readonly currentContext: string | undefined;
	readonly requestRetries: number;
	readonly requestRetryDelayMilliseconds: number;
}

/**
 * Chooses the connection as the `endia` CLI chooses it when it is given neither `--host` nor `--context`:
 *
 * 1. `EASTINDIA_HOST`, with the certificate files in `EASTINDIA_CERT_PATH`, or else in the configuration folder;
 * 2. otherwise the context `EASTINDIA_CONTEXT` names;
 * 3. otherwise `currentContext` in `config.json`;
 * 4. otherwise the built-in context `default`: the named pipe on Windows, `tcp://127.0.0.1:7443` elsewhere with the certificate files
 *    in the configuration folder.
 *
 * The configuration folder is `EASTINDIA_CONFIG`, or else `.eastindia` in the home folder. A stored context lives where the CLI
 * stores it, in Docker's layout: `contexts/meta/<SHA-256 of the name>/meta.json`, and the certificate files in
 * `contexts/tls/<SHA-256 of the name>/eastindia/`.
 *
 * @param environment - The environment variables.
 * @param home - The home folder.
 * @param windows - Whether this computer runs Windows, which decides the built-in context's address.
 * @returns The connection.
 * @throws Error when `config.json` holds an unknown key or a value out of range, when the context named does not exist, or when a
 * certificate file cannot be read; the message names the file or the context.
 */
export function connectionFromEnvironment(
	environment: Readonly<Record<string, string | undefined>>,
	home: string = homedir(),
	windows: boolean = process.platform === "win32",
): EnvironmentConnection {
	const configFolder = path.resolve(environment[EnvironmentVariables.config] ?? path.join(home, ConfigFolderName));
	const settings = readSettings(path.join(configFolder, SettingsFileName));
	const chosen = chooseContext(environment, settings, configFolder, windows);
	return {
		host: chosen.host,
		tls: chosen.host.startsWith("tcp://") ? readTlsFolder(chosen.certificateFolder) : undefined,
		requestRetries: settings.requestRetries,
		requestRetryDelayMilliseconds: settings.requestRetryDelayMilliseconds,
	};
}

/**
 * Reads the three certificate files of a folder: `ca.pem`, `cert.pem` and `key.pem`.
 *
 * @param folder - The folder.
 * @returns The files' text.
 * @throws Error naming the file that is missing or cannot be read.
 */
export function readTlsFolder(folder: string): TlsFiles {
	const read = (name: string): string => {
		const file = path.join(folder, name);
		try {
			return readFileSync(file, "utf8");
		}
		catch (error) {
			throw new Error(`Cannot read ${name} at ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
		}
	};

	return { ca: read("ca.pem"), cert: read("cert.pem"), key: read("key.pem") };
}

function chooseContext(environment: Readonly<Record<string, string | undefined>>, settings: CliSettings, configFolder: string, windows: boolean): { host: string; certificateFolder: string } {
	const host = environment[EnvironmentVariables.host];
	if (host !== undefined) {
		return { host, certificateFolder: environment[EnvironmentVariables.certPath] ?? configFolder };
	}

	const name = environment[EnvironmentVariables.context] ?? settings.currentContext ?? DefaultContext;
	if (name === DefaultContext) {
		return { host: windows ? DefaultPipeHost : DefaultTcpHost, certificateFolder: configFolder };
	}

	// Docker names a context's folders by the SHA-256 of its name, so that any name is a valid folder name.
	const folderName = createHash("sha256").update(name, "utf8").digest("hex");
	const metaFile = path.join(configFolder, "contexts", "meta", folderName, "meta.json");
	if (!existsSync(metaFile)) {
		throw new Error(`Context "${name}" does not exist: ${metaFile} is missing.`);
	}

	const meta = JSON.parse(readFileSync(metaFile, "utf8")) as { Endpoints?: Record<string, { Host?: string } | undefined> };
	const endpoint = meta.Endpoints?.[EndpointKey]?.Host;
	if (endpoint === undefined) {
		throw new Error(`${metaFile} names no ${EndpointKey} endpoint.`);
	}

	return { host: endpoint, certificateFolder: path.join(configFolder, "contexts", "tls", folderName, EndpointKey) };
}

// Reads config.json as the CLI reads it: an unknown key, or a value of the wrong type or out of range, is refused and named.
function readSettings(file: string): CliSettings {
	if (!existsSync(file)) {
		return { currentContext: undefined, requestRetries: RequestRetries.default, requestRetryDelayMilliseconds: RequestRetryDelayMilliseconds.default };
	}

	const keys = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
	for (const key of Object.keys(keys)) {
		if (!["currentContext", "requestRetries", "requestRetryDelayMilliseconds"].includes(key)) {
			throw new Error(`${file} holds the unknown key '${key}'.`);
		}
	}

	const currentContext = keys["currentContext"];
	if (currentContext !== undefined && currentContext !== null && typeof currentContext !== "string") {
		throw new Error(`${file}: 'currentContext' must be a string.`);
	}

	return {
		currentContext: currentContext ?? undefined,
		requestRetries: integerSetting(file, keys, "requestRetries", RequestRetries),
		requestRetryDelayMilliseconds: integerSetting(file, keys, "requestRetryDelayMilliseconds", RequestRetryDelayMilliseconds),
	};
}

function integerSetting(file: string, keys: Record<string, unknown>, key: string, range: { default: number; minimum: number; maximum: number }): number {
	const value = keys[key];
	if (value === undefined) {
		return range.default;
	}

	if (typeof value !== "number" || !Number.isInteger(value) || value < range.minimum || value > range.maximum) {
		throw new Error(`${file}: '${key}' must be an integer from ${String(range.minimum)} to ${String(range.maximum)}.`);
	}

	return value;
}
