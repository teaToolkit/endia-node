import type { HostStats, MachineStats } from "../contract/stats.js";
import { Routes } from "../routes.js";
import type { ApiConnection } from "../transport/api-connection.js";
import { QueryText } from "../transport/query-text.js";

/** Whether a readings route keeps sending readings or sends one. */
export interface StatsOptions {
	/**
	 * Whether the service keeps sending a new reading at its configured interval until the caller stops iterating. When false or
	 * undefined, the service sends one reading and ends the stream.
	 */
	readonly stream?: boolean;
	readonly signal?: AbortSignal;
}

/** The readings routes: a machine's processor, memory, network and disk use, and the host's: `endia stats`. */
export class StatsClient {
	private readonly connection: ApiConnection;

	/** @internal */
	constructor(connection: ApiConnection) {
		this.connection = connection;
	}

	/**
	 * Reads a machine's readings: `endia stats MACHINE`.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param options - `stream` keeps reading; one reading by default.
	 * @returns The readings, as they arrive.
	 */
	machine(machine: string, options: StatsOptions = {}): AsyncGenerator<MachineStats, void, undefined> {
		return this.connection.readLines(Routes.machineStats(machine) + streamQuery(options), options.signal);
	}

	/**
	 * Reads the host's readings: `endia stats --host`.
	 *
	 * @param options - `stream` keeps reading; one reading by default.
	 * @returns The readings, as they arrive.
	 */
	host(options: StatsOptions = {}): AsyncGenerator<HostStats, void, undefined> {
		return this.connection.readLines(Routes.hostStats + streamQuery(options), options.signal);
	}
}

// A readings route without the stream parameter streams, as Docker's does, so the client always sends the parameter, false included.
function streamQuery(options: StatsOptions): string {
	return new QueryText().add("stream", options.stream ?? false).toString();
}
