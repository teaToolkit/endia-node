import type { ApiError } from "./contract/common.js";
import type { MachineSummary } from "./contract/machines.js";
import type { Operation } from "./contract/operations.js";

/**
 * The service answered and refused: a request it would not carry out, or an operation it started that ended without succeeding.
 * Without this type a caller would match message text; with it, the caller reads `code`, the API's error code, such as `NOT_FOUND`
 * or `BUILD_FAILED`.
 */
export class EastIndiaApiError extends Error {
	/** The HTTP status of the refusal, such as 404; undefined when an operation ended without succeeding. */
	readonly status: number | undefined;

	/** The service's error, or null when a refusal came without a readable body. */
	readonly error: ApiError | null;

	/** The operation that ended without succeeding; undefined for a refused request. */
	readonly operation: Operation | undefined;

	/**
	 * Describes a refusal or an unsuccessful operation.
	 *
	 * @param status - The HTTP status of a refusal; undefined for an operation.
	 * @param error - The service's error, or null when none could be read.
	 * @param operation - The operation that ended without succeeding, for an operation.
	 */
	constructor(status: number | undefined, error: ApiError | null, operation?: Operation) {
		super(EastIndiaApiError.describe(status, error, operation));
		this.name = "EastIndiaApiError";
		this.status = status;
		this.error = error;
		this.operation = operation;
	}

	/** The API's error code, such as `NOT_FOUND`, or undefined when the refusal carried no readable error. */
	get code(): string | undefined {
		return this.error?.code;
	}

	/** The field at fault, such as `reference` or `services.web.ports[0]`, or undefined when no one field is at fault. */
	get fieldPath(): string | undefined {
		return this.error?.fieldPath ?? undefined;
	}

	/**
	 * Describes an operation that ended without succeeding, from the error the operation records.
	 *
	 * @param operation - The finished operation, in the state `failed`, `cancelled` or `interrupted`.
	 * @returns The error, which carries the operation.
	 */
	static fromOperation(operation: Operation): EastIndiaApiError {
		return new EastIndiaApiError(undefined, operation.error ?? null, operation);
	}

	private static describe(status: number | undefined, error: ApiError | null, operation: Operation | undefined): string {
		const subject = operation === undefined ? `The service answered ${String(status)}` : `Operation ${operation.id} (${operation.kind}) ended ${operation.state}`;
		if (error === null) {
			return `${subject}.`;
		}

		const field = error.fieldPath ? ` [${error.fieldPath}]` : "";
		return `${subject} (${error.code}): ${error.message}${field}`;
	}
}

/**
 * Why a request got no answer from the service.
 *
 * - `unreachable`: nothing answered at the address, or the connection broke before an answer arrived.
 * - `certificateRefused`: the service refused the client certificate, because another authority issued it, it has expired or it
 *   was revoked.
 * - `serverNotTrusted`: the server's certificate does not chain to EastIndia's authority in `ca.pem`, or does not name the address.
 * - `pipeRefused`: Windows refused to open the service's named pipe for this account.
 * - `timedOut`: the request had no answer within the client's request time limit.
 */
export type ConnectionFailure = "unreachable" | "certificateRefused" | "serverNotTrusted" | "pipeRefused" | "timedOut";

/**
 * No answer came from the service. Without this type a caller could not tell a stopped service from a refused certificate, because
 * Node reports each of them as a socket or TLS error; `failure` says which it was, and `cause` holds Node's own error.
 */
export class EastIndiaConnectionError extends Error {
	/** Why no answer came. */
	readonly failure: ConnectionFailure;

	/** The address as messages name it: the host and port, or the named pipe's path. */
	readonly address: string;

	/**
	 * Describes a request that got no answer.
	 *
	 * @param address - The host and port, or the named pipe's path.
	 * @param failure - Why no answer came.
	 * @param cause - The error Node reported.
	 */
	constructor(address: string, failure: ConnectionFailure, cause: unknown) {
		super(EastIndiaConnectionError.describe(address, failure), { cause });
		this.name = "EastIndiaConnectionError";
		this.failure = failure;
		this.address = address;
	}

	private static describe(address: string, failure: ConnectionFailure): string {
		switch (failure) {
			case "certificateRefused":
				return `The EastIndia service at ${address} refused the client certificate.`;
			case "serverNotTrusted":
				return `The server at ${address} did not present a certificate from the EastIndia authority in ca.pem.`;
			case "pipeRefused":
				return `Windows refused access to the EastIndia service at ${address}: add your account to the eastindia-users group, then sign out and in again.`;
			case "timedOut":
				return `The EastIndia service at ${address} did not answer within the client's request time limit.`;
			case "unreachable":
				return `Cannot connect to the EastIndia service at ${address}. Is the service running?`;
		}
	}
}

/**
 * A machine exited or became unhealthy while `FleetsClient.wait` waited for its fleet, as `endia compose up --wait` then exits
 * with 1. Without this type a caller could not tell a failed machine from a refused request; `machine` is the machine as the wait
 * last read it.
 */
export class MachineFailedError extends Error {
	/** The machine as the wait last read it. */
	readonly machine: MachineSummary;

	/**
	 * Describes a machine that ended a wait.
	 *
	 * @param machine - The machine, exited or unhealthy.
	 */
	constructor(machine: MachineSummary) {
		super(`machine ${machine.name} is ${machine.state === "exited" ? `exited (${String(machine.exitCode)})` : "unhealthy"}`);
		this.name = "MachineFailedError";
		this.machine = machine;
	}
}
