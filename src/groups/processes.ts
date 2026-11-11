import type { Timestamp } from "../contract/common.js";
import type { ProcessDetail, ProcessLogLine, ProcessStopResult, ProcessSummary, ProcessWaitResult } from "../contract/processes.js";
import { Routes } from "../routes.js";
import type { ApiConnection } from "../transport/api-connection.js";
import { QueryText } from "../transport/query-text.js";

/** Which process a request means, beyond its ID. */
export interface ProcessIdentity {
	/**
	 * The time the process must have started, copied from the answer that named the process, such as the `started` member of a
	 * detached exec's answer. Windows reuses process IDs, so the time tells the process apart from a later one with the same ID.
	 * When the process with the ID started at another time, the service refuses the request with `NOT_FOUND`. When `started` is
	 * undefined, the request means whichever process has the ID.
	 */
	readonly started?: Timestamp;
	readonly signal?: AbortSignal;
}

/**
 * The process routes of a running machine: list, inspect, wait, stop and read the output of a program started detached. A request
 * names a process by its Windows process ID, which a detached exec and a desktop launch return.
 */
export class ProcessesClient {
	private readonly connection: ApiConnection;

	/** @internal */
	constructor(connection: ApiConnection) {
		this.connection = connection;
	}

	/**
	 * Lists the machine's processes: `endia process ls`.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param signal - Cancels the request.
	 * @returns The processes.
	 */
	list(machine: string, signal?: AbortSignal): Promise<ProcessSummary[]> {
		return this.connection.read(Routes.processes(machine), signal);
	}

	/**
	 * Reads one process: `endia process inspect`.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param processId - The Windows process ID.
	 * @param options - The process's start time.
	 * @returns The process, with its exit code once it has ended.
	 */
	inspect(machine: string, processId: number, options: ProcessIdentity = {}): Promise<ProcessDetail> {
		return this.connection.read(Routes.process(machine, processId) + new QueryText().add("started", options.started).toString(), options.signal);
	}

	/**
	 * Waits until a process ends: `endia process wait`. The service answers only when the process has ended or the time-out has
	 * passed, so the client's own time limit does not apply.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param processId - The Windows process ID.
	 * @param options - `timeout` is the longest wait in seconds; without it the wait has no limit. When the time-out passes first, the
	 * service refuses the request with `TIMEOUT`, and the process keeps running.
	 * @returns The exit code in full, such as 3010; null when EastIndia did not start the process on the machine's current boot, because
	 * only then does it know the exit code.
	 */
	wait(machine: string, processId: number, options: ProcessIdentity & { readonly timeout?: number } = {}): Promise<ProcessWaitResult> {
		const query = new QueryText().add("timeout", options.timeout).add("started", options.started);
		return this.connection.change({ method: "POST", path: Routes.processWait(machine, processId) + query.toString(), signal: options.signal }, false);
	}

	/**
	 * Ends a process as `docker stop` ends a container: `endia process stop`. The service first asks the process to close, by
	 * sending a close message to each of its top-level windows, or a `CTRL_BREAK` event to a console process without windows. When the
	 * process has not ended within the time-out, the service ends it with exit code 1.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param processId - The Windows process ID.
	 * @param options - `timeout` is the time in seconds the process has to close, 10 when undefined; 0 ends it at once.
	 * @returns How the process ended, and its exit code when known.
	 */
	stop(machine: string, processId: number, options: ProcessIdentity & { readonly timeout?: number } = {}): Promise<ProcessStopResult> {
		const query = new QueryText().add("t", options.timeout).add("started", options.started);
		return this.connection.change({ method: "POST", path: Routes.processStop(machine, processId) + query.toString(), signal: options.signal }, false);
	}

	/**
	 * Reads the output a detached program wrote: `endia process logs`. Only a program started detached on the machine's current
	 * boot has its output kept; for any other process the service refuses the request with `NOT_FOUND`.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param processId - The Windows process ID.
	 * @param options - `follow` keeps reading new lines until the process ends.
	 * @returns The lines, each naming its stream, as they arrive.
	 */
	logs(machine: string, processId: number, options: { readonly follow?: boolean; readonly signal?: AbortSignal } = {}): AsyncGenerator<ProcessLogLine, void, undefined> {
		return this.connection.readLines(Routes.processLogs(machine, processId) + new QueryText().addFlag("follow", options.follow).toString(), options.signal);
	}
}
