import type { ApiError, Timestamp } from "./common.js";

/**
 * Work the service carries out in the background because it takes seconds to hours and must survive the caller disconnecting:
 * a build, an import, a fleet or machine change, or a prune.
 *
 * @typeParam TResult - The result the operation's kind gives when it succeeds.
 */
export interface Operation<TResult = unknown> {
	/** 32 lower-case hexadecimal digits. */
	readonly id: string;
	/** What the operation does: `import`, `basePrepare`, `build`, `prune`, `fleetUp`, `fleetDown`, `fleetStop`, `fleetStart`, `fleetRestart`, `machineStart`, `machineStop` or `machineRestart`. */
	readonly kind: string;
	/** The image reference, fleet or machine the operation works on. */
	readonly target: string;
	/** `queued`, `running`, `cancelling`, or one of the final states `succeeded`, `failed`, `cancelled` and `interrupted`. */
	readonly state: string;
	/** The step the operation is on, such as `Step 2/5 : RUN setup.cmd`, or null. */
	readonly step?: string | null;
	readonly created: Timestamp;
	readonly started?: Timestamp | null;
	readonly finished?: Timestamp | null;
	/** The name of the client certificate that started the operation. */
	readonly caller: string;
	/** The result, once the operation has succeeded; otherwise null. */
	readonly result?: TResult | null;
	/** Why the operation failed, was cancelled or was interrupted; otherwise null. */
	readonly error?: ApiError | null;
}
