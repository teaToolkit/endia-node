import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import type { Filters } from "../contract/common.js";
import type { Operation } from "../contract/operations.js";
import { EastIndiaApiError } from "../errors.js";
import { Routes } from "../routes.js";
import type { ApiConnection } from "../transport/api-connection.js";
import { QueryText } from "../transport/query-text.js";

/** The states after which an operation never changes again. */
const FinalStates: ReadonlySet<string> = new Set(["succeeded", "failed", "cancelled", "interrupted"]);

/**
 * The pause before a followed log is read again when it ended while the operation had not yet finished, as when the connection
 * broke. It keeps a service that keeps closing the stream from being asked again at once, over and over.
 */
const FollowAgainDelayMilliseconds = 1000;

/**
 * Says whether an operation has finished: succeeded, failed, been cancelled or been interrupted.
 *
 * @param operation - The operation as last read.
 * @returns True when its state never changes again.
 */
export function isFinished(operation: Operation): boolean {
	return FinalStates.has(operation.state);
}

/** The options of reading an operation's log. */
export interface OperationLogOptions {
	/** Whether the stream stays open until the operation finishes. */
	readonly follow?: boolean;
	/** The number of lines from the end of the log to start with; the whole log when undefined. */
	readonly tail?: number;
	readonly signal?: AbortSignal;
}

/** The options of waiting for an operation to finish. */
export interface OperationWaitOptions {
	/** Receives the operation's log text as the service writes it, each piece once. */
	readonly onLog?: (text: string) => void;
	readonly signal?: AbortSignal;
}

/**
 * The operation routes: list, inspect, read the log, cancel; and handles that follow one operation to its end. Every route that
 * starts work returns an `OperationHandle` built here.
 */
export class OperationsClient {
	private readonly connection: ApiConnection;

	/** @internal */
	constructor(connection: ApiConnection) {
		this.connection = connection;
	}

	/**
	 * Lists every kept operation, newest first: `endia operation ls`.
	 *
	 * @param options - `filters` such as `{ state: ["running"], kind: ["build"] }`.
	 * @returns The operations.
	 */
	list(options: { readonly filters?: Filters; readonly signal?: AbortSignal } = {}): Promise<Operation[]> {
		return this.connection.read(Routes.operations + new QueryText().addJson("filters", options.filters).toString(), options.signal);
	}

	/**
	 * Reads one operation: `endia operation inspect`.
	 *
	 * @param id - The operation ID or a unique prefix of it.
	 * @param signal - Cancels the request.
	 * @returns The operation.
	 */
	inspect<TResult = unknown>(id: string, signal?: AbortSignal): Promise<Operation<TResult>> {
		return this.connection.read(Routes.operation(id), signal);
	}

	/**
	 * Opens an operation's log, the lines the command prints as the CLI prints them: `endia operation logs`.
	 *
	 * @param id - The operation ID or a unique prefix of it.
	 * @param options - With `follow`, the stream stays open until the operation finishes.
	 * @returns The log as UTF-8 text.
	 */
	async logs(id: string, options: OperationLogOptions = {}): Promise<Readable> {
		const query = new QueryText().add("follow", options.follow ?? false).add("tail", options.tail);
		const stream = await this.connection.openStream({ method: "GET", path: Routes.operationLog(id) + query.toString(), signal: options.signal });
		return stream.setEncoding("utf8");
	}

	/**
	 * Asks the service to cancel an operation: `endia operation cancel`. A build or import cleans up as on failure; a fleet or machine
	 * operation stops before its next machine step; a prune stops before its next deletion.
	 *
	 * @param id - The operation ID or a unique prefix of it.
	 * @param signal - Cancels the request.
	 * @returns The operation in `cancelling`, or unchanged when it had already finished.
	 */
	cancel(id: string, signal?: AbortSignal): Promise<Operation> {
		return this.connection.change({ method: "POST", path: Routes.operationCancel(id), signal });
	}

	/**
	 * Wraps an operation that was read elsewhere, such as one another program started, in a handle that follows it and waits for its
	 * end.
	 *
	 * @param operation - The operation as last read.
	 * @returns The handle.
	 */
	handle<TResult>(operation: Operation): OperationHandle<TResult> {
		return new OperationHandle<TResult>(this, operation);
	}
}

/**
 * Work the service has accepted and carries out in the background: a build, an import, a fleet or machine change, or a prune. The
 * handle follows that work: it reads the operation's state, follows its log, cancels it, and waits for it to finish.
 *
 * @typeParam TResult - The result the operation gives when it succeeds, such as `BuildResult`.
 */
export class OperationHandle<TResult> {
	private readonly operations: OperationsClient;

	/** The operation as the service answered when it accepted the work. */
	readonly accepted: Operation;

	/** @internal */
	constructor(operations: OperationsClient, accepted: Operation) {
		this.operations = operations;
		this.accepted = accepted;
	}

	/** The operation ID: 32 lower-case hexadecimal digits. */
	get id(): string {
		return this.accepted.id;
	}

	/**
	 * Reads the operation as it stands now.
	 *
	 * @param signal - Cancels the request.
	 * @returns The operation.
	 */
	inspect(signal?: AbortSignal): Promise<Operation<TResult>> {
		return this.operations.inspect<TResult>(this.id, signal);
	}

	/**
	 * Opens the operation's log.
	 *
	 * @param options - With `follow`, the stream stays open until the operation finishes.
	 * @returns The log as UTF-8 text.
	 */
	logs(options: OperationLogOptions = {}): Promise<Readable> {
		return this.operations.logs(this.id, options);
	}

	/**
	 * Asks the service to cancel the operation. The operation then ends `cancelled`, which `wait` reports.
	 *
	 * @param signal - Cancels the request.
	 * @returns The operation in `cancelling`, or unchanged when it had already finished.
	 */
	cancel(signal?: AbortSignal): Promise<Operation> {
		return this.operations.cancel(this.id, signal);
	}

	/**
	 * Waits until the operation finishes, whatever its outcome, by following its log to the end as the CLI does.
	 *
	 * When the followed log ends before the operation has finished, as when the connection breaks, the log is opened again after a
	 * pause. The log only grows, so the text `onLog` has already received is skipped and each piece reaches it once.
	 *
	 * @param options - `onLog` receives the log as it is written.
	 * @returns The finished operation, in `succeeded`, `failed`, `cancelled` or `interrupted`.
	 */
	async wait(options: OperationWaitOptions = {}): Promise<Operation<TResult>> {
		let delivered = 0;
		for (;;) {
			const log = await this.logs({ follow: true, signal: options.signal });
			let read = 0;
			for await (const text of log as AsyncIterable<string>) {
				const unseen = text.slice(Math.max(0, delivered - read));
				read += text.length;
				delivered += unseen.length;
				if (unseen.length > 0) {
					options.onLog?.(unseen);
				}
			}

			const operation = await this.inspect(options.signal);
			if (isFinished(operation)) {
				return operation;
			}

			await delay(FollowAgainDelayMilliseconds, undefined, { signal: options.signal });
		}
	}

	/**
	 * Waits until the operation finishes and gives its result.
	 *
	 * @param options - `onLog` receives the log as it is written.
	 * @returns The result of the succeeded operation.
	 * @throws EastIndiaApiError when the operation failed, was cancelled or was interrupted; its `code` is the operation's error code,
	 * such as `BUILD_FAILED`, and its `operation` is the finished operation.
	 */
	async result(options: OperationWaitOptions = {}): Promise<TResult> {
		const operation = await this.wait(options);
		if (operation.state !== "succeeded") {
			throw EastIndiaApiError.fromOperation(operation);
		}

		return operation.result as TResult;
	}
}
