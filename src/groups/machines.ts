import type { Filters } from "../contract/common.js";
import type { MachineDetail, MachineLogLine, MachineRestartResult, MachineSummary, MachinesResult } from "../contract/machines.js";
import type { Operation } from "../contract/operations.js";
import type { MachinePurpose, MachinePurposeResult } from "../contract/purposes.js";
import { purposeBody } from "../purposes.js";
import { Routes } from "../routes.js";
import { jsonBody, type ApiConnection } from "../transport/api-connection.js";
import { QueryText } from "../transport/query-text.js";
import type { OperationHandle, OperationsClient } from "./operations.js";

/** Which lines of a machine's main-process output to read, as `endia logs` chooses them. */
export interface LogOptions {
	/** Whether to keep reading new lines as the machine writes them, until the caller stops iterating. */
	readonly follow?: boolean;
	/** The number of lines from the end to start with, or `all`; every line when undefined. */
	readonly tail?: number | "all";
	/** The earliest line, as Docker writes the time: RFC 3339, Unix seconds, or a duration before now such as `10m`. */
	readonly since?: string;
	/** The latest line, in the same forms as `since`. */
	readonly until?: string;
	/** Ends the request; the iteration then throws the signal's reason. */
	readonly signal?: AbortSignal;
}

/**
 * Adds the query parameters of a log request.
 *
 * @param query - The query to add to.
 * @param options - The lines to read.
 * @returns The query.
 */
export function addLogOptions(query: QueryText, options: LogOptions): QueryText {
	return query.addFlag("follow", options.follow).add("tail", options.tail).add("since", options.since).add("until", options.until);
}

/**
 * The machine routes: list, inspect, start, stop, restart, read the log, and read, set and clear a machine's own purpose. A machine is made and removed with its fleet
 * (`FleetsClient.up` and `FleetsClient.down`). Starting, stopping and restarting return an `OperationHandle`, because the service
 * does that work in the background.
 */
export class MachinesClient {
	private readonly connection: ApiConnection;
	private readonly operations: OperationsClient;

	/** @internal */
	constructor(connection: ApiConnection, operations: OperationsClient) {
		this.connection = connection;
		this.operations = operations;
	}

	/**
	 * Lists machines: `endia ps`.
	 *
	 * @param options - `all` includes machines that are not running; `filters` such as `{ label: ["team=qa"] }`.
	 * @returns The machines.
	 */
	list(options: { readonly all?: boolean; readonly filters?: Filters; readonly signal?: AbortSignal } = {}): Promise<MachineSummary[]> {
		const query = new QueryText().addFlag("all", options.all).addJson("filters", options.filters);
		return this.connection.read(Routes.machines + query.toString(), options.signal);
	}

	/**
	 * Reads one machine: `endia inspect`.
	 *
	 * @param name - The machine name or a unique prefix of its ID.
	 * @param signal - Cancels the request.
	 * @returns The machine.
	 */
	inspect(name: string, signal?: AbortSignal): Promise<MachineDetail> {
		return this.connection.read(Routes.machine(name), signal);
	}

	/**
	 * Reads a machine's own purpose with every change to it, and the purpose in effect for the machine, its own or else its fleet's:
	 * `endia purpose show`.
	 *
	 * @param name - The machine name or a unique prefix of its ID.
	 * @param signal - Cancels the request.
	 * @returns The machine's own purpose and history, and its effective purpose with where it comes from.
	 */
	purpose(name: string, signal?: AbortSignal): Promise<MachinePurpose> {
		return this.connection.read(Routes.machinePurpose(name), signal);
	}

	/**
	 * Replaces a machine's own purpose, which overrides its fleet's for this machine only: `endia purpose set`.
	 *
	 * @param name - The machine name or a unique prefix of its ID.
	 * @param title - What the machine is being used for, in one line of 1 to 200 characters.
	 * @param options - `detail` is Markdown notes of at most 65536 bytes in UTF-8; without it the detail stored before is cleared.
	 * @returns The purpose now stored, which is also the machine's effective purpose.
	 * @throws Error when the title has a line break or the detail is too long. Nothing is sent then.
	 */
	async setPurpose(name: string, title: string, options: { readonly detail?: string; readonly signal?: AbortSignal } = {}): Promise<MachinePurposeResult> {
		const body = purposeBody(title, options.detail);
		return await this.connection.change({ method: "PUT", path: Routes.machinePurpose(name), body: jsonBody(body), signal: options.signal });
	}

	/**
	 * Removes a machine's own purpose, which returns the machine to its fleet's: `endia purpose clear`.
	 *
	 * @param name - The machine name or a unique prefix of its ID.
	 * @param signal - Cancels the request.
	 * @returns The machine's own purpose now stored, which is null, and its effective purpose, which is its fleet's or null.
	 */
	clearPurpose(name: string, signal?: AbortSignal): Promise<MachinePurposeResult> {
		return this.connection.change({ method: "DELETE", path: Routes.machinePurpose(name), signal });
	}

	/**
	 * Starts a stopped machine: `endia start`.
	 *
	 * @param name - The machine name or a unique prefix of its ID.
	 * @param signal - Cancels the request.
	 * @returns The start's operation; its result names the machine.
	 */
	start(name: string, signal?: AbortSignal): Promise<OperationHandle<MachinesResult>> {
		return this.sendAction<MachinesResult>(Routes.machineStart(name), new QueryText(), signal);
	}

	/**
	 * Shuts a machine's Windows down: `endia stop`.
	 *
	 * @param name - The machine name or a unique prefix of its ID.
	 * @param options - `timeout` is the time in seconds Windows has to shut down before the virtual machine is turned off.
	 * @returns The stop's operation; its result names the machine.
	 */
	stop(name: string, options: { readonly timeout?: number; readonly signal?: AbortSignal } = {}): Promise<OperationHandle<MachinesResult>> {
		return this.sendAction<MachinesResult>(Routes.machineStop(name), new QueryText().add("t", options.timeout), options.signal);
	}

	/**
	 * Restarts a machine's Windows: `endia restart`.
	 *
	 * @param name - The machine name or a unique prefix of its ID.
	 * @param options - `timeout` as for `stop`; `hard` turns the virtual machine off and on instead of restarting Windows.
	 * @returns The restart's operation; its result has the boot IDs before and after.
	 */
	restart(name: string, options: { readonly timeout?: number; readonly hard?: boolean; readonly signal?: AbortSignal } = {}): Promise<OperationHandle<MachineRestartResult>> {
		const query = new QueryText().add("t", options.timeout).addFlag("hard", options.hard);
		return this.sendAction<MachineRestartResult>(Routes.machineRestart(name), query, options.signal);
	}

	/**
	 * Reads a machine's main-process output, one line at a time: `endia logs`.
	 *
	 * @param name - The machine name or a unique prefix of its ID.
	 * @param options - Which lines, and whether to follow new ones.
	 * @returns The lines, as they arrive.
	 */
	logs(name: string, options: LogOptions = {}): AsyncGenerator<MachineLogLine, void, undefined> {
		return this.connection.readLines(Routes.machineLogs(name) + addLogOptions(new QueryText(), options).toString(), options.signal);
	}

	private async sendAction<TResult>(path: string, query: QueryText, signal: AbortSignal | undefined): Promise<OperationHandle<TResult>> {
		const accepted = await this.connection.change<Operation>({ method: "POST", path: path + query.toString(), signal });
		return this.operations.handle<TResult>(accepted);
	}
}
